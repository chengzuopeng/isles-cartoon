import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Bitmap {
    var width: Int
    var height: Int
    var pixels: [UInt8]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

func load(_ path: String) -> Bitmap {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("cannot read \(path)") }
    let width = image.width
    let height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let context = CGContext(
        data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return Bitmap(width: width, height: height, pixels: pixels)
}

func makeImage(_ bitmap: Bitmap) -> CGImage {
    var pixels = bitmap.pixels
    let context = CGContext(
        data: &pixels, width: bitmap.width, height: bitmap.height, bitsPerComponent: 8, bytesPerRow: bitmap.width * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    return context.makeImage()!
}

func save(_ image: CGImage, _ path: String, quality: Double = 0.86) {
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let isJpeg = path.lowercased().hasSuffix(".jpg") || path.lowercased().hasSuffix(".jpeg")
    let type = (isJpeg ? UTType.jpeg : UTType.png).identifier as CFString
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, type, 1, nil) else { fail("cannot write \(path)") }
    let options = isJpeg ? [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary : nil
    CGImageDestinationAddImage(destination, image, options)
    if !CGImageDestinationFinalize(destination) { fail("cannot write \(path)") }
}

func smoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
    let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
    return t * t * (3 - 2 * t)
}

func keyMagenta(_ bitmap: inout Bitmap) {
    for i in stride(from: 0, to: bitmap.pixels.count, by: 4) {
        var r = Double(bitmap.pixels[i])
        let g = Double(bitmap.pixels[i + 1])
        var b = Double(bitmap.pixels[i + 2])
        let peak = max(r, g, b, 1)
        let magenta = (min(r, b) - g) / peak
        let alpha = 1 - smoothstep(0.42, 0.7, magenta)
        let spill = max(0, min(r, b) - g) * (1 - alpha)
        if r > g { r = max(g, r - spill) }
        if b > g { b = max(g, b - spill) }
        bitmap.pixels[i] = UInt8(r * alpha)
        bitmap.pixels[i + 1] = UInt8(g * alpha)
        bitmap.pixels[i + 2] = UInt8(b * alpha)
        bitmap.pixels[i + 3] = UInt8(255 * alpha)
    }
}

func opaqueBounds(_ bitmap: Bitmap) -> (x: Int, y: Int, width: Int, height: Int) {
    var minX = bitmap.width, minY = bitmap.height, maxX = -1, maxY = -1
    for y in 0..<bitmap.height {
        for x in 0..<bitmap.width where bitmap.pixels[(y * bitmap.width + x) * 4 + 3] > 24 {
            minX = min(minX, x); maxX = max(maxX, x)
            minY = min(minY, y); maxY = max(maxY, y)
        }
    }
    if maxX < 0 { return (0, 0, bitmap.width, bitmap.height) }
    return (minX, minY, maxX - minX + 1, maxY - minY + 1)
}

func render(_ image: CGImage, crop: CGRect, width: Int, height: Int, pad: Double, anchorBottom: Bool) -> CGImage {
    let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    let innerW = Double(width) * (1 - pad * 2)
    let innerH = Double(height) * (1 - pad * 2)
    let scale = min(innerW / crop.width, innerH / crop.height)
    let drawW = crop.width * scale
    let drawH = crop.height * scale
    let x = (Double(width) - drawW) / 2
    let y = anchorBottom ? 0 : (Double(height) - drawH) / 2
    let source = image.cropping(to: crop) ?? image
    context.draw(source, in: CGRect(x: x, y: y, width: drawW, height: drawH))
    return context.makeImage()!
}

func cover(_ image: CGImage, width: Int, height: Int) -> CGImage {
    let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    let scale = max(Double(width) / Double(image.width), Double(height) / Double(image.height))
    let drawW = Double(image.width) * scale
    let drawH = Double(image.height) * scale
    context.draw(image, in: CGRect(x: (Double(width) - drawW) / 2, y: (Double(height) - drawH) / 2, width: drawW, height: drawH))
    return context.makeImage()!
}

func sheet(_ paths: [String], cell: Int, columns: Int, out: String) {
    let rows = (paths.count + columns - 1) / columns
    let context = CGContext(
        data: nil, width: cell * columns, height: cell * rows, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setFillColor(CGColor(red: 0.18, green: 0.2, blue: 0.24, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: cell * columns, height: cell * rows))
    for (index, path) in paths.enumerated() {
        let bitmap = load(path)
        let image = makeImage(bitmap)
        let col = index % columns
        let row = rows - 1 - index / columns
        let scale = min(Double(cell - 8) / Double(image.width), Double(cell - 8) / Double(image.height))
        let w = Double(image.width) * scale
        let h = Double(image.height) * scale
        let x = Double(col * cell) + (Double(cell) - w) / 2
        let y = Double(row * cell) + (Double(cell) - h) / 2
        context.draw(image, in: CGRect(x: x, y: y, width: w, height: h))
    }
    save(context.makeImage()!, out)
}

func seam(_ bitmap: Bitmap, blend: Double) -> Bitmap {
    let span = max(1, Int(Double(bitmap.width) * blend))
    let width = bitmap.width - span
    var pixels = [UInt8](repeating: 0, count: width * bitmap.height * 4)
    for y in 0..<bitmap.height {
        for x in 0..<width {
            let out = (y * width + x) * 4
            let near = (y * bitmap.width + x) * 4
            if x >= span {
                for c in 0..<4 { pixels[out + c] = bitmap.pixels[near + c] }
                continue
            }
            let far = (y * bitmap.width + width + x) * 4
            let t = smoothstep(0, 1, Double(x) / Double(span))
            for c in 0..<4 {
                pixels[out + c] = UInt8(min(255, max(0, (Double(bitmap.pixels[far + c]) * (1 - t) + Double(bitmap.pixels[near + c]) * t).rounded())))
            }
        }
    }
    return Bitmap(width: width, height: bitmap.height, pixels: pixels)
}

func crop(_ bitmap: Bitmap, x: Int, y: Int, width: Int, height: Int) -> Bitmap {
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    for row in 0..<height {
        let from = ((y + row) * bitmap.width + x) * 4
        let to = row * width * 4
        for i in 0..<(width * 4) { pixels[to + i] = bitmap.pixels[from + i] }
    }
    return Bitmap(width: width, height: height, pixels: pixels)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
    fail("usage: art-tool key <in> <out.png> <width> <height> [pad] [bottom] | trim <in> <out.png> <width> <height> [pad] | fit <in> <out> <width> <height> | sheet <out.png> <cell> <columns> <in...> | seam <in> <out> <width> <height> [blend] | split <in> <out-prefix> <columns> <rows> <width> <height> [pad] [inset] | region <in> <out> <x0> <y0> <x1> <y1> <width> <height> [pad]")
}

switch command {
case "key":
    guard args.count >= 5, let width = Int(args[3]), let height = Int(args[4]) else { fail("key <in> <out.png> <width> <height> [pad] [bottom]") }
    let pad = args.count >= 6 ? Double(args[5]) ?? 0.04 : 0.04
    let bottom = args.count >= 7 && args[6] == "bottom"
    var bitmap = load(args[1])
    keyMagenta(&bitmap)
    let bounds = opaqueBounds(bitmap)
    let crop = CGRect(x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height)
    save(render(makeImage(bitmap), crop: crop, width: width, height: height, pad: pad, anchorBottom: bottom), args[2])
case "trim":
    guard args.count >= 5, let width = Int(args[3]), let height = Int(args[4]) else { fail("trim <in> <out.png> <width> <height> [pad]") }
    let pad = args.count >= 6 ? Double(args[5]) ?? 0.04 : 0.04
    let bitmap = load(args[1])
    let bounds = opaqueBounds(bitmap)
    let crop = CGRect(x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height)
    save(render(makeImage(bitmap), crop: crop, width: width, height: height, pad: pad, anchorBottom: false), args[2])
case "fit":
    guard args.count >= 5, let width = Int(args[3]), let height = Int(args[4]) else { fail("fit <in> <out> <width> <height>") }
    save(cover(makeImage(load(args[1])), width: width, height: height), args[2])
case "seam":
    guard args.count >= 5, let width = Int(args[3]), let height = Int(args[4]) else { fail("seam <in> <out> <width> <height> [blend]") }
    let blend = args.count >= 6 ? Double(args[5]) ?? 0.08 : 0.08
    save(cover(makeImage(seam(load(args[1]), blend: blend)), width: width, height: height), args[2])
case "split":
    guard args.count >= 7, let columns = Int(args[3]), let rows = Int(args[4]), let width = Int(args[5]), let height = Int(args[6]) else { fail("split <in> <out-prefix> <columns> <rows> <width> <height> [pad] [inset]") }
    let pad = args.count >= 8 ? Double(args[7]) ?? 0.04 : 0.04
    let inset = args.count >= 9 ? Double(args[8]) ?? 0 : 0
    var bitmap = load(args[1])
    keyMagenta(&bitmap)
    let cellW = bitmap.width / columns
    let cellH = bitmap.height / rows
    for index in 0..<(columns * rows) {
        let margin = Int(Double(cellW) * inset)
        let cell = crop(bitmap, x: (index % columns) * cellW + margin, y: (index / columns) * cellH, width: cellW - margin * 2, height: cellH)
        let bounds = opaqueBounds(cell)
        let rect = CGRect(x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height)
        save(render(makeImage(cell), crop: rect, width: width, height: height, pad: pad, anchorBottom: false), "\(args[2])-\(index + 1).png")
    }
case "region":
    guard args.count >= 9, let x0 = Double(args[3]), let y0 = Double(args[4]), let x1 = Double(args[5]), let y1 = Double(args[6]), let width = Int(args[7]), let height = Int(args[8]) else { fail("region <in> <out> <x0> <y0> <x1> <y1> <width> <height> [pad]") }
    let pad = args.count >= 10 ? Double(args[9]) ?? 0.04 : 0.04
    var bitmap = load(args[1])
    keyMagenta(&bitmap)
    let left = Int(x0 * Double(bitmap.width))
    let top = Int(y0 * Double(bitmap.height))
    let cell = crop(bitmap, x: left, y: top, width: Int(x1 * Double(bitmap.width)) - left, height: Int(y1 * Double(bitmap.height)) - top)
    let bounds = opaqueBounds(cell)
    let rect = CGRect(x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height)
    save(render(makeImage(cell), crop: rect, width: width, height: height, pad: pad, anchorBottom: false), args[2])
case "sheet":
    guard args.count >= 5, let cell = Int(args[2]), let columns = Int(args[3]) else { fail("sheet <out.png> <cell> <columns> <in...>") }
    sheet(Array(args[4...]), cell: cell, columns: columns, out: args[1])
default:
    fail("unknown command \(command)")
}
