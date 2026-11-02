import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def argument(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


WEAPON = argument("--id")
SOURCE = argument("--source")
REFERENCE = argument("--reference", os.path.join(HERE, "..", "..", "..", "..", "game", "art", "models", WEAPON or "", f"{WEAPON}.glb"))
OUT = argument("--out", os.path.join(HERE, f"fp-{WEAPON}.glb"))
PREVIEW_DIR = argument("--preview-dir", os.path.join(tempfile.gettempdir(), f"fp-{WEAPON}-preview"))
TEXTURE = int(argument("--texture", "2048"))
PREVIEW = "--no-preview" not in ARGS
EXPORT = "--no-export" not in ARGS

SAMPLES = 6000
ICP_ROUNDS = 12


def import_any(path):
    before = set(bpy.data.objects)
    if path.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    added = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in added if o.type == "MESH"]
    empties = {o.name: o.matrix_world.translation.copy() for o in added if o.type == "EMPTY"}
    for obj in meshes:
        obj.data.transform(obj.matrix_world)
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
    for obj in [o for o in added if o.type != "MESH"]:
        bpy.data.objects.remove(obj)
    return meshes, empties


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


def sample(points, count):
    if len(points) <= count:
        return points
    step = len(points) / count
    return points[(np.arange(count) * step).astype(np.int64)]


def tree_of(points):
    tree = KDTree(len(points))
    for index, point in enumerate(points):
        tree.insert(point, index)
    tree.balance()
    return tree


def nearest(tree, points):
    found = np.empty_like(points)
    distances = np.empty(len(points))
    for index, point in enumerate(points):
        co, _, distance = tree.find(point)
        found[index] = co
        distances[index] = distance
    return found, distances


def candidates(points):
    extent = points.max(axis=0) - points.min(axis=0)
    long_axis = 0 if extent[0] >= extent[1] else 1
    base = 0.0 if long_axis == 0 else math.pi / 2
    return [Matrix.Rotation(-base, 4, "Z"), Matrix.Rotation(math.pi - base, 4, "Z")]


def fit(points, reference, tree):
    best = None
    for rotation in candidates(points):
        rotated = points @ np.array(rotation.to_3x3()).T
        scale = (reference[:, 0].max() - reference[:, 0].min()) / (rotated[:, 0].max() - rotated[:, 0].min())
        scaled = rotated * scale
        shift = (reference.max(axis=0) + reference.min(axis=0)) / 2 - (scaled.max(axis=0) + scaled.min(axis=0)) / 2
        moved = sample(scaled, SAMPLES) + shift
        for _ in range(ICP_ROUNDS):
            found, _ = nearest(tree, moved)
            step = (found - moved).mean(axis=0)
            moved += step
            shift += step
        _, distances = nearest(tree, moved)
        score = float(np.mean(distances))
        print(f"fp-{WEAPON} candidate score {score:.4f}")
        if best is None or score < best[0]:
            best = (score, rotation, scale, shift)
    return best


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


def build():
    old_meshes, old_empties = import_any(REFERENCE)
    reference = np.concatenate([positions(o) for o in old_meshes])
    socket = old_empties.get("socket_muzzle")
    for obj in old_meshes:
        bpy.data.objects.remove(obj)
    tree = tree_of(sample(reference, SAMPLES * 2))
    gun = join(import_any(SOURCE)[0], "body")
    score, rotation, scale, shift = fit(positions(gun), reference, tree)
    gun.data.transform(rotation)
    gun.data.transform(Matrix.Scale(scale, 4))
    gun.data.transform(Matrix.Translation(Vector(shift)))
    flatten_materials(gun)
    points = positions(gun)
    print(f"fp-{WEAPON} score {score:.4f}, scale {scale:.4f}, faces {len(gun.data.polygons)}, size {np.round(points.max(axis=0) - points.min(axis=0), 3)}")
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)
    muzzle = bpy.data.objects.new("socket_muzzle", None)
    bpy.context.scene.collection.objects.link(muzzle)
    if socket is not None:
        muzzle.location = socket
    else:
        front = points[points[:, 0] > points[:, 0].max() - 0.01]
        muzzle.location = Vector((float(points[:, 0].max()), float(front[:, 1].mean()), float(front[:, 2].mean())))
    gun.parent = root
    muzzle.parent = root
    return root, gun


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


def preview(gun):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_object_outline = True
    scene.world = bpy.data.worlds.new("preview")
    scene.world.color = (0.38, 0.62, 0.92)
    old_meshes, _ = import_any(REFERENCE)
    for obj in old_meshes:
        obj.location.y += 0.3
    points = positions(gun)
    center = Vector(((points.max(axis=0) + points.min(axis=0)) / 2).tolist())
    length = float(points[:, 0].max() - points[:, 0].min())
    side = make_camera("side", center + Vector((0.0, -2.2 * length, 0.0)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)), 30)
    scene.camera = side
    scene.render.resolution_x, scene.render.resolution_y = 1200, 700
    scene.render.filepath = os.path.join(PREVIEW_DIR, "side.png")
    bpy.ops.render.render(write_still=True)
    for obj in old_meshes:
        obj.location.y -= 0.3
        obj.hide_render = False
    gun.hide_render = False
    scene.display.shading.color_type = "OBJECT"
    gun.color = (0.9, 0.5, 0.2, 1)
    for obj in old_meshes:
        obj.color = (0.3, 0.5, 0.95, 1)
    scene.render.filepath = os.path.join(PREVIEW_DIR, "overlay.png")
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root, gun = build()
    if EXPORT:
        for obj in bpy.context.scene.objects:
            obj.select_set(obj is root or obj.parent is root)
        bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True)
    if PREVIEW:
        preview(gun)


main()
