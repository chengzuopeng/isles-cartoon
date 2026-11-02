import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fp-arms.glb")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def argument(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


RIGHT = argument("--right", os.path.join(HERE, "..", "fp-arm-right", "fp-arm-right.glb"))
LEFT = argument("--left", os.path.join(HERE, "..", "fp-arm-left", "fp-arm-left.glb"))
BLASTER = argument("--blaster", os.path.join(HERE, "..", "..", "..", "..", "game", "art", "models", "blaster", "blaster.glb"))
PREVIEW = "--no-preview" not in ARGS
EXPORT = "--no-export" not in ARGS
TAG = argument("--tag", "")
TEXTURE = int(argument("--texture", "2048"))
PREVIEW_DIR = argument("--preview-dir", os.path.join(tempfile.gettempdir(), "fp-arms-preview"))

REST = Vector((0.17, -0.1, -0.41))
HOLDER = (0.05, 2.15, 0.06)
GUN_SCALE = 0.62
FOV = 50

TILT = math.radians(15)
TARGETS = {
    "arm_r": {
        "center": Vector((-0.012, 0.0, -0.042)),
        "down": Vector((-math.sin(TILT), 0.0, -math.cos(TILT))),
        "front": Vector((math.cos(TILT), 0.0, -math.sin(TILT))),
        "fist": float(argument("--fist", "0.128")),
        "shift": tuple(float(v) for v in argument("--shift", "0.032,0.026").split(",")),
    },
    "arm_l": {
        "center": Vector(tuple(float(v) for v in argument("--bar", "0.22,0,0.065").split(","))),
        "front": Vector((1.0, 0.0, 0.0)),
        "up": Vector((0.0, 0.0, 1.0)),
        "scale": float(argument("--left-scale", "0.439")),
    },
}
HANDLE_GREY = {"spread": 28, "bright": 110, "cap": 0.08}
CLIP_MARGIN = {"length": 1.04, "section": 1.12}


def three_matrix():
    rx = Matrix.Rotation(HOLDER[0], 3, "X")
    ry = Matrix.Rotation(HOLDER[1], 3, "Y")
    rz = Matrix.Rotation(HOLDER[2], 3, "Z")
    return rz @ rx @ ry


def to_blender(v):
    return Vector((v.x, -v.z, v.y))


def import_mesh(path, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"no mesh in {path}")
    for obj in meshes:
        obj.data.transform(obj.matrix_world)
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
    for obj in [o for o in bpy.data.objects if o not in before and o.type != "MESH"]:
        bpy.data.objects.remove(obj)
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes):
            bpy.ops.object.join()
    obj = meshes[0]
    obj.name = name
    return obj


def flatten_materials(obj):
    for material in obj.data.materials:
        if not material or not material.use_nodes:
            continue
        tree = material.node_tree
        for node in tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            for name in ("Normal", "Metallic", "Roughness"):
                for link in list(node.inputs[name].links):
                    tree.links.remove(link)
            node.inputs["Metallic"].default_value = 0.0
            node.inputs["Roughness"].default_value = 0.85
            if "Specular IOR Level" in node.inputs:
                node.inputs["Specular IOR Level"].default_value = 0.25
        for node in list(tree.nodes):
            if node.type in ("NORMAL_MAP", "SEPARATE_COLOR", "SEPRGB") or (node.type == "TEX_IMAGE" and not node.outputs["Color"].links):
                tree.nodes.remove(node)
    image = base_color_image(obj)
    if image and max(image.size) > TEXTURE:
        image.scale(TEXTURE, TEXTURE)


def base_color_image(obj):
    for material in obj.data.materials:
        if not material or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                links = node.inputs["Base Color"].links
                if links and links[0].from_node.type == "TEX_IMAGE":
                    return links[0].from_node.image
    return None


def vertex_colors(obj):
    image = base_color_image(obj)
    if image is None:
        raise RuntimeError("no base color texture")
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(height, width, 4)
    mesh = obj.data
    uv = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    loops = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", loops)
    px = np.clip((uv[:, 0] % 1.0) * width, 0, width - 1).astype(np.int32)
    py = np.clip((uv[:, 1] % 1.0) * height, 0, height - 1).astype(np.int32)
    colors = pixels[py, px, :3] * 255
    total = np.zeros((len(mesh.vertices), 3), dtype=np.float64)
    count = np.zeros(len(mesh.vertices), dtype=np.float64)
    np.add.at(total, loops, colors)
    np.add.at(count, loops, 1)
    return total / np.maximum(count, 1)[:, None]


def positions(obj):
    mesh = obj.data
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def handle_frame(obj):
    colors = vertex_colors(obj)
    points = positions(obj)
    spread = colors.max(axis=1) - colors.min(axis=1)
    grey = (spread < HANDLE_GREY["spread"]) & (colors.mean(axis=1) > HANDLE_GREY["bright"])
    candidates = points[grey]
    if len(candidates) < 12:
        raise RuntimeError(f"handle not found ({len(candidates)} grey vertices)")
    middle = np.median(candidates, axis=0)
    distance = np.linalg.norm(candidates - middle, axis=1)
    candidates = candidates[distance < np.percentile(distance, 85) * 1.3]
    low, high = candidates[:, 2].min(), candidates[:, 2].max()
    band = (high - low) * HANDLE_GREY["cap"]
    top = candidates[candidates[:, 2] > high - band].mean(axis=0)
    bottom = candidates[candidates[:, 2] < low + band].mean(axis=0)
    center = Vector((top + bottom) / 2)
    down = Vector(bottom - top).normalized()
    arm = Vector(points.mean(axis=0)) - center
    back = (arm - down * arm.dot(down)).normalized()
    front = -back
    right = down.cross(front).normalized()
    front = right.cross(down).normalized()
    basis = np.array([list(down), list(front), list(right)]).T
    caps = candidates[(candidates[:, 2] > high - band) | (candidates[:, 2] < low + band)]
    local = (caps - np.array(center)) @ basis
    extent = local.max(axis=0) - local.min(axis=0)
    others = (points[~grey] - np.array(center)) @ basis
    length = float((high - low))
    near = others[(np.abs(others[:, 0]) < length / 4) & (np.abs(others[:, 1]) < length / 2)]
    fist = float(np.percentile(near[:, 2], 98) - np.percentile(near[:, 2], 2)) if len(near) else float(extent[2])
    return {
        "fist": fist,
        "center": center,
        "down": down,
        "front": front,
        "right": right,
        "length": length,
        "depth": float(extent[1]),
        "width": float(extent[2]),
        "count": int(len(candidates)),
    }


def grey_points(obj):
    colors = vertex_colors(obj)
    points = positions(obj)
    spread = colors.max(axis=1) - colors.min(axis=1)
    grey = (spread < HANDLE_GREY["spread"]) & (colors.mean(axis=1) > HANDLE_GREY["bright"])
    candidates = points[grey]
    if len(candidates) < 12:
        raise RuntimeError(f"bar not found ({len(candidates)} grey vertices)")
    middle = np.median(candidates, axis=0)
    distance = np.linalg.norm(candidates - middle, axis=1)
    return points, candidates[distance < np.percentile(distance, 85) * 1.3]


def bar_frame(obj):
    points, candidates = grey_points(obj)
    center = candidates.mean(axis=0)
    _, vectors = np.linalg.eigh(np.cov((candidates - center).T))
    axis = Vector(vectors[:, 2]).normalized()
    arm = Vector(points.mean(axis=0) - center)
    front = -axis if arm.dot(axis) > 0 else axis
    up = (-arm - front * (-arm).dot(front)).normalized()
    side = front.cross(up).normalized()
    up = side.cross(front).normalized()
    local = (candidates - center) @ np.array([list(front), list(up), list(side)]).T
    middle = (local.max(axis=0) + local.min(axis=0)) / 2
    center = Vector(center) + front * middle[0] + up * middle[1] + side * middle[2]
    extent = local.max(axis=0) - local.min(axis=0)
    return {"center": center, "front": front, "up": up, "side": side, "length": float(extent[0]), "extent": extent, "count": len(candidates)}


def align_bar(obj, target):
    frame = bar_frame(obj)
    source = Matrix((frame["front"], frame["up"], frame["side"])).transposed()
    goal_side = target["front"].cross(target["up"]).normalized()
    goal = Matrix((target["front"], target["up"], goal_side)).transposed()
    rotation = goal @ source.inverted()
    scale = target["scale"]
    obj.matrix_world = Matrix.Translation(target["center"]) @ (rotation.to_4x4() @ Matrix.Scale(scale, 4)) @ Matrix.Translation(-frame["center"])
    print(f"{obj.name}: bar {frame['count']} verts, length {frame['length']:.3f}, scale {scale:.3f}")
    return frame


def to_gltf(v):
    return [round(v[0], 6), round(v[2], 6), round(-v[1], 6)]


def store_clip(obj, frame):
    half = [frame["length"] / 2 * CLIP_MARGIN["length"], frame["depth"] / 2 * CLIP_MARGIN["section"], frame["width"] / 2 * CLIP_MARGIN["section"]]
    obj["clip"] = {
        "center": to_gltf(frame["center"]),
        "axes": [to_gltf(frame["down"]), to_gltf(frame["front"]), to_gltf(frame["right"])],
        "half": [round(h, 6) for h in half],
    }


def align(obj, target):
    frame = handle_frame(obj)
    store_clip(obj, frame)
    source = Matrix((frame["down"], frame["front"], frame["right"])).transposed()
    goal_right = target["down"].cross(target["front"]).normalized()
    goal = Matrix((target["down"], target["front"], goal_right)).transposed()
    rotation = goal @ source.inverted()
    scale = target["fist"] / frame["fist"]
    forward, up = target["shift"]
    goal_center = target["center"] + target["front"] * forward - target["down"] * up
    matrix = Matrix.Translation(goal_center) @ (rotation.to_4x4() @ Matrix.Scale(scale, 4)) @ Matrix.Translation(-frame["center"])
    obj.matrix_world = matrix
    print(f"{obj.name}: handle {frame['count']} verts, length {frame['length']:.3f} depth {frame['depth']:.3f} width {frame['width']:.3f}, fist {frame['fist']:.3f}, scale {scale:.3f}")
    return frame


def render(path, camera, width=1280, height=720):
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def make_camera(name, location, forward, up, fov):
    camera = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    bpy.context.scene.collection.objects.link(camera)
    z_axis = -forward.normalized()
    y_axis = (up - z_axis * up.dot(z_axis)).normalized()
    x_axis = y_axis.cross(z_axis)
    camera.matrix_world = Matrix.Translation(location) @ Matrix((x_axis, y_axis, z_axis)).transposed().to_4x4()
    camera.data.clip_start = 0.005
    camera.data.sensor_fit = "VERTICAL"
    camera.data.angle = math.radians(fov)
    return camera


def preview(arms):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_object_outline = True
    scene.world = bpy.data.worlds.new("preview")
    scene.world.color = (0.38, 0.62, 0.92)
    if os.path.exists(BLASTER):
        bpy.ops.import_scene.gltf(filepath=BLASTER)
    rotation = three_matrix().transposed()
    eye = to_blender(rotation @ (-REST)) / GUN_SCALE
    forward = to_blender(rotation @ Vector((0.0, 0.0, -1.0)))
    up = to_blender(rotation @ Vector((0.0, 1.0, 0.0)))
    first = make_camera("first-person", eye, forward, up, FOV)
    target = TARGETS["arm_r"]["center"] + Vector((0.0, 0.0, 0.02))
    close = make_camera("close", eye, target - eye, up, 16)
    side = make_camera("side", Vector((0.0, -1.2, 0.0)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)), 30)
    if TAG:
        render(os.path.join(PREVIEW_DIR, f"preview-two-hands{TAG}.png"), first)
        render(os.path.join(PREVIEW_DIR, f"preview-hand-two{TAG}.png"), close, 900, 900)
        return
    for obj in arms.values():
        obj.hide_render = obj.name != "arm_r"
    render(os.path.join(PREVIEW_DIR, "preview-first-person.png"), first)
    render(os.path.join(PREVIEW_DIR, "preview-hand.png"), close, 900, 900)
    render(os.path.join(PREVIEW_DIR, "preview-side.png"), side, 1000, 700)
    if "arm_l" in arms:
        for obj in arms.values():
            obj.hide_render = False
        render(os.path.join(PREVIEW_DIR, "preview-two-hands.png"), first)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arms = {}
    if os.path.exists(RIGHT):
        arms["arm_r"] = import_mesh(RIGHT, "arm_r")
        align(arms["arm_r"], TARGETS["arm_r"])
        flatten_materials(arms["arm_r"])
    if os.path.exists(LEFT) and "arm_l" in TARGETS:
        arms["arm_l"] = import_mesh(LEFT, "arm_l")
        align_bar(arms["arm_l"], TARGETS["arm_l"])
        flatten_materials(arms["arm_l"])
    if not arms:
        raise RuntimeError("no arm models found")
    for name, obj in arms.items():
        print(json.dumps({"node": name, "triangles": sum(len(p.vertices) - 2 for p in obj.data.polygons)}))
    if EXPORT:
        for obj in bpy.context.scene.objects:
            obj.select_set(obj in arms.values())
        bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_extras=True)
    if PREVIEW:
        preview(arms)


main()
