# 麻将 3D 模型 · Blender 制作

包含可编辑的 `mahjong-assets-v1.blend`、31 个独立 GLB、生成脚本和真实模型渲染预览。

## 内容

- `glb/tiles/wan-01.glb` 至 `wan-09.glb`：一至九万。
- `glb/tiles/suo-01.glb` 至 `suo-09.glb`：一至九条。
- `glb/tiles/tong-01.glb` 至 `tong-09.glb`：一至九筒。
- `glb/tile-back.glb`：同尺寸、牌背朝上的无字版本。
- `glb/dice.glb`：六面骰子；一和四为红点，其余为黑点，对面点数相加为七，点数为凹面。
- `glb/dealer-marker.glb`：庄家标。
- `glb/mahjong-table.glb`：四腿麻将桌，胡桃木桌体、深绿色扶手、绿色桌面和金属装饰。
- `previews/`：从重新导入的 GLB 模型实际渲染的图片。
- `catalog.json`：尺寸、三角面数量、文件大小和导入验证结果。

## 牌面与模型

27 张牌直接复用游戏里已经核对过的 SVG 图案，转换为实际的曲线／文字网格。文字已经转换为几何体，使用模型时无需安装中文字体。牌面为薄层网格嵌饰，未将整张 AI 效果图贴到模型上。

每张牌有独立的象牙白牌体、绿色背层和牌面图案。二条上下两根竖竹，八条上 W 下 M，七筒上三点斜排；万子数字黑色、萬字红色。

Blender 源文件中的胡桃木纹理已打包；GLB 为独立文件，所需纹理嵌入文件内部。

## 尺寸与坐标

- 使用米作为单位；牌体宽 26 mm、长 34 mm、厚 18 mm。
- GLB 使用标准 +Y 向上；牌面朝 +Y，长边沿 Z，原点位于牌底中心。
- 桌子外宽约 1.10 m，绿色桌面高度 0.758 m；以 `catalog.json` 中实际包围盒为准。
- 可以旋转任意一张牌显示真实绿色背面，`tile-back.glb` 仅为方便使用的牌背朝上版本。

## 重新生成

在项目根目录运行：

```powershell
node --preserve-symlinks-main assets/mahjong-3d/source/extract-faces.js
& 'D:\blender\blender.exe' --background --factory-startup --python-exit-code 1 --python assets/mahjong-3d/source/build-assets.py
```

当前使用 Blender 4.5.2 LTS。生成文字时读取本机 `C:/Windows/Fonts/simkai.ttf`；字体文件本身未作为素材提供。若迁移到其他电脑，在脚本中把 `FONT_FILE` 改为可用的中文楷体字体。

脚本会更新本目录内自己生成的模型和预览，完整渲染使用 CPU。所有 GLB 导出后会逐个重新导入；预览从重新导入的模型生成。

## 使用范围

本次交付为建模素材；尚未替换线上游戏的 HTML/CSS 渲染，也未引入 Three.js。GLB 可以作为下一阶段 3D 牌桌的输入。牌面保留网格图案便于编辑；手机同屏大量复制时，可进一步将图案烘焙为纹理图集并使用实例化。
