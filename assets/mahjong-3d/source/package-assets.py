"""Check the exported GLBs and package only the model deliverables."""
import hashlib
import html
import json
import struct
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parents[1]
catalog = json.loads((ROOT / 'catalog.json').read_text(encoding='utf-8'))
assert catalog['asset_count'] == 31 and catalog['tile_count'] == 27
assert catalog['verification']['glb_reimports'] == 31
checks = []
for asset in catalog['assets']:
    path = ROOT / 'glb' / asset['file']
    content = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', content)
    assert (magic, version, length) == (b'glTF', 2, len(content)), path
    json_length, chunk_type = struct.unpack_from('<II', content, 12)
    assert chunk_type == 0x4E4F534A
    gltf = json.loads(content[20:20+json_length])
    assert gltf.get('meshes') and gltf.get('scenes'), path
    assert all('uri' not in buffer for buffer in gltf['buffers']), path
    assert all('bufferView' in image for image in gltf.get('images', [])), path
    checks.append({'id':asset['id'], 'bytes':len(content),
                   'sha256':hashlib.sha256(content).hexdigest(),
                   'embeddedTextures':len(gltf.get('images', []))})

source = ROOT / 'mahjong-assets-v1.blend'
assert source.read_bytes()[:7] == b'BLENDER'
for name in ('tiles-overview.png', 'table-preview.png', 'accessories-preview.png'):
    assert (ROOT / 'previews' / name).read_bytes()[:8] == b'\x89PNG\r\n\x1a\n'
validation = {'validGlbs':len(checks), 'standaloneFiles':True,
              'totalGlbBytes':sum(c['bytes'] for c in checks),
              'totalTriangles':sum(a['triangles'] for a in catalog['assets']),
              'renderedFromReimportedModels':True, 'files':checks}
(ROOT / 'asset-validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf-8')

links = '\n'.join('<a href="glb/'+html.escape(a['file'])+'">'+html.escape(a['name'])+'</a>' for a in catalog['assets'])
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>麻将 · Blender 模型</title>
<style>body{margin:0;background:#102b25;color:#f5efdf;font:16px/1.7 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px}h1,h2{margin-bottom:8px}p{color:#bdcdbf}a{color:#efcf87}img{display:block;width:100%;border-radius:16px;margin:16px 0 32px}.links{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px}.links a{padding:12px;background:#1e4035;border-radius:8px;text-align:center;text-decoration:none}.pair{display:grid;grid-template-columns:1fr 1fr;gap:22px}@media(max-width:700px){main{padding:18px}.pair{grid-template-columns:1fr}}</style>
<main><h1>麻将 · Blender 3D 模型</h1><p>27 张牌 + 牌桌、牌背、骰子和庄家标。31 个独立 GLB 均已重新导入 Blender 验证。下方图片是模型实际渲染。</p>
<a href="mahjong-assets-v1.blend">打开可编辑 Blender 源文件</a> · <a href="README.md">使用说明</a>
<h2>27 张牌</h2><img src="previews/tiles-overview.png" alt="27 张麻将的实际模型渲染">
<div class="pair"><section><h2>麻将桌</h2><img src="previews/table-preview.png" alt="麻将桌模型"></section>
<section><h2>配套模型</h2><img src="previews/accessories-preview.png" alt="牌背、骰子和庄家标"></section></div>
<h2>独立 GLB 文件</h2><div class="links">'''+links+'''</div><p>GLB 牌体为 26 × 34 × 18 mm，标准 +Y 向上。当前交付为建模素材，尚未接入线上游戏。</p></main></html>'''
(ROOT / 'index.html').write_text(page,encoding='utf-8')

destination = PROJECT / 'output' / 'mahjong-blender-assets-v1.zip'
if destination.exists():
    raise FileExistsError('Archive already exists; use a new version instead of overwriting it.')
files = [p for p in ROOT.rglob('*') if p.is_file() and not p.name.endswith(('.log','.blend1','.pyc'))
         and '__pycache__' not in p.parts]
with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for path in files:
        archive.write(path, Path('mahjong-3d') / path.relative_to(ROOT))
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert len([p for p in archive.namelist() if p.endswith('.glb')]) == 31
print(json.dumps({'validGlbs':len(checks),'triangles':validation['totalTriangles'],
                  'sourceBlendBytes':source.stat().st_size,'zipBytes':destination.stat().st_size,
                  'zip':str(destination),'files':len(files)},ensure_ascii=False))
