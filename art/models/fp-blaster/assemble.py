import math
import os
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def argument(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


SOURCE = argument("--source")
OUT = argument("--out", os.path.join(HERE, "fp-blaster.glb"))
REFERENCE = argument("--reference", os.path.join(HERE, "..", "..", "..", "..", "game", "art", "models", "blaster", "blaster.glb"))
ARMS = argument("--arms", os.path.join(HERE, "..", "fp-arms", "fp-arms.glb"))
PREVIEW_DIR = argument("--preview-dir", os.path.join(tempfile.gettempdir(), "fp-blaster-preview"))
TEXTURE = int(argument("--texture", "2048"))
PREVIEW = "--no-preview" not in ARGS
EXPORT = "--no-export" not in ARGS

TARGET_LENGTH = 0.42
GRIP_BAND = 0.3
MUZZLE_BAND = 0.025
COIL_COLOR = {"min_blue": 0.45, "min_lead": 0.12}
COIL_RUN = {"bin": 0.004, "min_faces": 60, "coverage": 10}
SHROUD = {"start": 0.74, "end": 0.97, "sectors": 8, "offset": math.pi / 8, "inner": 0.42}
COIL_ZONE = (0.42, 0.8)

REST = Vector((0.17, -0.1, -0.41))
HOLDER = (0.05, 2.15, 0.06)
GUN_SCALE = 0.62
FOV = 50


def import_any(path):
    before = set(bpy.data.objects)
    if path.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    for obj in meshes:
        obj.data.transform(obj.matrix_world)
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
    for obj in [o for o in bpy.data.objects if o not in before and o.type != "MESH"]:
        bpy.data.objects.remove(obj)
    return meshes


def join(objects, name):
    if len(objects) > 1:
        with bpy.context.temp_override(active_object=objects[0], selected_editable_objects=objects):
            bpy.ops.object.join()
    objects[0].name = name
    return objects[0]


def positions(obj):
    co = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def gun_frame(points):
    extent = points.max(axis=0) - points.min(axis=0)
    long_axis = 0 if extent[0] >= extent[1] else 1
    low = points[points[:, 2] < points[:, 2].min() + extent[2] * 0.15]
    middle = (points[:, long_axis].max() + points[:, long_axis].min()) / 2
    forward = -1.0 if low[:, long_axis].mean() > middle else 1.0
    direction = Vector((0.0, 0.0, 0.0))
    direction[long_axis] = forward
    angle = math.atan2(direction.y, direction.x)
    return Matrix.Rotation(-angle, 4, "Z")


def grip_x(points):
    height = points[:, 2].max() - points[:, 2].min()
    low = points[points[:, 2] < points[:, 2].min() + height * GRIP_BAND]
    return float(low[:, 0].mean())


def reference_frame():
    meshes = import_any(REFERENCE)
    points = np.concatenate([positions(o) for o in meshes])
    frame = {"grip": grip_x(points), "bottom": float(points[:, 2].min()), "length": float(points[:, 0].max() - points[:, 0].min())}
    for obj in meshes:
        bpy.data.objects.remove(obj)
    return frame


def align(objects, reference):
    points = np.concatenate([positions(o) for o in objects])
    rotation = gun_frame(points)
    for obj in objects:
        obj.data.transform(rotation)
    points = np.concatenate([positions(o) for o in objects])
    scale = TARGET_LENGTH / float(points[:, 0].max() - points[:, 0].min())
    for obj in objects:
        obj.data.transform(Matrix.Scale(scale, 4))
    points = np.concatenate([positions(o) for o in objects])
    shift = Vector((reference["grip"] - grip_x(points), -float(points[:, 1].mean()), reference["bottom"] - float(points[:, 2].min())))
    for obj in objects:
        obj.data.transform(Matrix.Translation(shift))
    return rotation, scale, shift


def muzzle_center(points):
    front = points[points[:, 0] > points[:, 0].max() - TARGET_LENGTH * MUZZLE_BAND]
    return Vector((float(points[:, 0].max()), float(front[:, 1].mean()), float(front[:, 2].mean())))


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


def face_colors(obj):
    image = base_color_image(obj)
    if image is None:
        return None
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(height, width, 4)
    mesh = obj.data
    uv = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    px = np.clip((uv[:, 0] % 1.0) * width, 0, width - 1).astype(np.int32)
    py = np.clip((uv[:, 1] % 1.0) * height, 0, height - 1).astype(np.int32)
    loop_colors = pixels[py, px, :3]
    starts = np.empty(len(mesh.polygons), dtype=np.int32)
    totals = np.empty(len(mesh.polygons), dtype=np.int32)
    mesh.polygons.foreach_get("loop_start", starts)
    mesh.polygons.foreach_get("loop_total", totals)
    sums = np.add.reduceat(loop_colors, starts, axis=0)
    return sums / totals[:, None]


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
            node.inputs["Roughness"].default_value = 0.7
            if "Specular IOR Level" in node.inputs:
                node.inputs["Specular IOR Level"].default_value = 0.35
        for node in list(tree.nodes):
            if node.type in ("NORMAL_MAP", "SEPARATE_COLOR", "SEPRGB") or (node.type == "TEX_IMAGE" and not node.outputs["Color"].links):
                tree.nodes.remove(node)
    image = base_color_image(obj)
    if image and max(image.size) > TEXTURE:
        image.scale(TEXTURE, TEXTURE)


def face_centers(obj):
    centers = np.empty(len(obj.data.polygons) * 3, dtype=np.float64)
    obj.data.polygons.foreach_get("center", centers)
    return centers.reshape(-1, 3)


def coverage(points, center):
    angles = np.arctan2(points[:, 2] - center.z, points[:, 1] - center.y)
    bins = np.floor((angles + math.pi) / (2 * math.pi) * 12).astype(np.int32) % 12
    return len(np.unique(bins))


def coil_runs(obj, colors, center, length, rear):
    if colors is None:
        return []
    centers = face_centers(obj)
    along = (centers[:, 0] - rear) / length
    cyan = (colors[:, 2] > COIL_COLOR["min_blue"]) & (colors[:, 2] - colors[:, 0] > COIL_COLOR["min_lead"])
    zone = cyan & (along > COIL_ZONE[0]) & (along < COIL_ZONE[1])
    bins = np.floor(along / COIL_RUN["bin"]).astype(np.int64)
    occupied = sorted(set(bins[zone].tolist()))
    runs = []
    for value in occupied:
        if runs and value - runs[-1][-1] <= 1:
            runs[-1].append(value)
        else:
            runs.append([value])
    groups = []
    for run in runs:
        faces = np.nonzero(zone & (bins >= run[0]) & (bins <= run[-1]))[0]
        if len(faces) >= COIL_RUN["min_faces"] and coverage(centers[faces], center) >= COIL_RUN["coverage"]:
            groups.append(faces)
    return groups


def split_faces(obj, groups, name):
    obj.name = "source"
    result = {}
    for key, faces in groups.items():
        if not len(faces):
            continue
        copy = obj.copy()
        copy.data = obj.data.copy()
        bpy.context.scene.collection.objects.link(copy)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        bm.faces.ensure_lookup_table()
        keep = set(int(i) for i in faces)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
        bm.to_mesh(copy.data)
        bm.free()
        copy.name = key
        result[key] = copy
    bpy.data.objects.remove(obj)
    return result


def shroud_petals(obj, labels_free, center, length, rear):
    centers = face_centers(obj)
    along = (centers[:, 0] - rear) / length
    radial = np.hypot(centers[:, 1] - center.y, centers[:, 2] - center.z)
    zone = (along > SHROUD["start"]) & (along < SHROUD["end"]) & labels_free
    if not zone.any():
        return {}
    outer = np.percentile(radial[zone], 95)
    zone &= radial > outer * SHROUD["inner"]
    angles = np.arctan2(centers[:, 2] - center.z, centers[:, 1] - center.y)
    sector = np.floor(((angles + math.pi + SHROUD["offset"]) % (2 * math.pi)) / (2 * math.pi) * SHROUD["sectors"]).astype(np.int32) % SHROUD["sectors"]
    return {k: np.nonzero(zone & (sector == k))[0] for k in range(SHROUD["sectors"])}


def set_origin(obj, origin):
    obj.data.transform(Matrix.Translation(-origin))
    obj.location = origin


def build(reference):
    sources = import_any(SOURCE)
    gun = join(sources, "body")
    rotation, scale, shift = align([gun], reference)
    points = positions(gun)
    center = muzzle_center(points)
    length = float(points[:, 0].max() - points[:, 0].min())
    rear = float(points[:, 0].min())
    groups = {}
    taken = np.zeros(len(gun.data.polygons), dtype=bool)
    for number, faces in enumerate(coil_runs(gun, face_colors(gun), center, length, rear), start=1):
        groups[f"coil_{number}"] = faces
        taken[faces] = True
    petals = shroud_petals(gun, ~taken, center, length, rear)
    for number, faces in enumerate([f for f in petals.values() if len(f)], start=1):
        groups[f"petal_{number}"] = faces
        taken[faces] = True
    groups["body"] = np.nonzero(~taken)[0]
    flatten_materials(gun)
    split = split_faces(gun, groups, "body")
    for name, obj in split.items():
        if name.startswith("petal_"):
            pts = positions(obj)
            set_origin(obj, Vector((float(pts[:, 0].min()), float(pts[:, 1].mean()), float(pts[:, 2].mean()))))
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)
    socket = bpy.data.objects.new("socket_muzzle", None)
    bpy.context.scene.collection.objects.link(socket)
    socket.location = center
    for obj in [*split.values(), socket]:
        obj.parent = root
    for name, obj in sorted(split.items()):
        print(f"fp-blaster {name}: {len(obj.data.polygons)} faces")
    return root, split


def three_matrix():
    rx = Matrix.Rotation(HOLDER[0], 3, "X")
    ry = Matrix.Rotation(HOLDER[1], 3, "Y")
    rz = Matrix.Rotation(HOLDER[2], 3, "Z")
    return rz @ rx @ ry


def to_blender(v):
    return Vector((v.x, -v.z, v.y))


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


def render(path, camera, width=1280, height=720):
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def preview(split):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_object_outline = True
    scene.world = bpy.data.worlds.new("preview")
    scene.world.color = (0.38, 0.62, 0.92)
    side = make_camera("side", Vector((0.14, -1.2, 0.03)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)), 24)
    render(os.path.join(PREVIEW_DIR, "side.png"), side, 1200, 800)
    front = make_camera("front", Vector((1.3, 0.0, 0.08)), Vector((-1.0, 0.0, 0.0)), Vector((0.0, 0.0, 1.0)), 16)
    render(os.path.join(PREVIEW_DIR, "front.png"), front, 900, 900)
    scene.display.shading.color_type = "OBJECT"
    palette = [(0.9, 0.3, 0.3, 1), (0.3, 0.8, 0.3, 1), (0.3, 0.4, 0.9, 1), (0.9, 0.8, 0.2, 1), (0.8, 0.3, 0.9, 1), (0.2, 0.8, 0.8, 1), (0.9, 0.5, 0.2, 1), (0.6, 0.6, 0.6, 1)]
    for index, (name, obj) in enumerate(sorted(split.items())):
        obj.color = (0.85, 0.85, 0.85, 1) if name == "body" else palette[index % len(palette)]
    render(os.path.join(PREVIEW_DIR, "parts-side.png"), side, 1200, 800)
    render(os.path.join(PREVIEW_DIR, "parts-front.png"), front, 900, 900)
    scene.display.shading.color_type = "TEXTURE"
    if os.path.exists(ARMS):
        import_any(ARMS)
    rotation = three_matrix().transposed()
    eye = to_blender(rotation @ (-REST)) / GUN_SCALE
    forward = to_blender(rotation @ Vector((0.0, 0.0, -1.0)))
    up = to_blender(rotation @ Vector((0.0, 1.0, 0.0)))
    render(os.path.join(PREVIEW_DIR, "first-person.png"), make_camera("first-person", eye, forward, up, FOV))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    reference = reference_frame()
    root, split = build(reference)
    if EXPORT:
        for obj in bpy.context.scene.objects:
            obj.select_set(obj is root or obj.parent is root)
        bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True)
    if PREVIEW:
        preview(split)


main()
