# EarthOnline

EarthOnline 是一个可以在浏览器中步行、驾车和参与生活工坊的三维城市探索游戏。仓库包含 TypeScript 客户端、Node.js 服务、可编辑地图、随附美术资源、内容编辑工具和自动化测试。

## 本地运行

使用 Node.js 22.18 或更新版本、npm，以及支持 WebGL 2 的浏览器。在仓库根目录运行以下命令，然后打开终端显示的本地网址。

```sh
npm ci
npm run dev
```

进入街区后可在鸟瞰和步行之间切换。拖动鼠标调整视角，WASD 或方向键移动，Shift 奔跑，空格跳跃。靠近起点的车按 F 上下车，行驶时空格是手刹。点「拍照」或按 Y 进入取景，再按一次生成可保存的 PNG。

## 可以体验什么

- **城市探索**。香港三个街区、东京四个街区，以及费城、蒙特利尔、墨尔本、赫尔辛基，共六座城市、十一个可选区域。地图数据随仓库提供，包含街道与建筑轮廓。建筑高度和道路宽度在部分区域使用估计值。
- **生活工坊**。可以拉面、叠冰淇淋、按食谱烹饪、钓鱼、洗车、裁衣、绘画和咖啡制作。画册可保存在浏览器本地或导出 PNG。
- **室内布置**。家具可以摆放、移动、旋转，桌面上的小件物体也可以调整。布局保存在当前浏览器。
- **街区挑战**。六个可编辑规则的小游戏，包含单人及多角色样例。可以试玩、修改 JSON、验证作品、保存修订和导出回放。在本地服务中可为受支持的合作作品建立最多四人的房间，八人和十六人样例可在本地切换角色或执行回放。

## 测试、构建和联机

```sh
npm test
npm run build
npm run preview
```

构建产物在 `dist/`，可以从站点根路径提供静态文件。纯静态托管支持城市探索、本地工坊和内置挑战。作品库、修订和房间使用开发或预览服务提供的 API。作品库存放在仓库以外的用户数据目录。城市场景内的「联机」另用一个 WebSocket 服务。保留前端进程，另开终端运行 `npm run server`，再从两个浏览器窗口进入同一街区并点击「联机」。默认服务监听本机 4174 端口，开发和预览服务器会转发 `/presence`。

## 仓库导览

| 路径 | 内容 |
| --- | --- |
| `src/city/`、`src/city-layers/`、`src/maps/` | 城市入口、道路和建筑几何、材质、天空和街区选择 |
| `src/exploration/`、`src/avatar/`、`src/photography/` | 角色和车辆物理、角色动画、跟随镜头、街景拍照 |
| `src/activities-public/`、`src/coffee/`、`src/home/` | 生活工坊、室内布局和存档 |
| `src/minigames/`、`shared/`、`scripts/` | 挑战编辑器、规则引擎、协议、打包和回放 |
| `server/` | 玩家位置同步、挑战作品库、联机房间和内容验证 |
| `public/` | 地图、角色、车辆、家具、材质、游戏定义和回放样例 |
| `tooling/`、`tests/` | 建筑贡献检查、Blender 工具和自动化测试 |

可以用下面的命令修改并验证挑战。建筑贡献包的文件格式和检查命令见 [工具说明](tooling/README.md)。

```sh
npm run game -- validate public/minigames/examples/collect.json
npm run game -- replay public/minigames/examples/cooperative.json public/minigames/replays/cooperative-win.json
```

## 许可

项目自有代码以 [MIT](LICENSE) 发布。地图、模型和材质各有自己的授权条件。分发相关文件时，请一并保留其许可与署名。

- 地理数据及相关声明见[地图来源](MAP-SOURCES.md)，游戏内也显示当前地区署名。
- 地表、角色、车辆和家具分别见[地表材质](MATERIAL-SOURCES.md)、[角色及动作](public/characters/SOURCES.md)、[车辆许可](public/vehicles/NOTICE.md)和[家具来源](public/room/SOURCES.md)。
- 工坊使用的扫描素材及织物贴图见[洗车场资料](src/activities-public/carwash/bay/ASSETS.md)和[布料贴图资料](src/activities-public/tailoring/TEXTURES.md)。
