# Three.js browser modules

Pinned version: **0.180.0**. Upstream: https://github.com/mrdoob/three.js/tree/r180

Files were downloaded from the matching npm distribution through jsDelivr. MIT license is preserved in `LICENSE.txt`.

- `three.module.js` is upstream `build/three.module.min.js`; its relative `three.core.min.js` import is preserved.
- `GLTFLoader.js`, `BufferGeometryUtils.js`, and `RoomEnvironment.js` have their module import paths changed to local sibling files. Leading indentation in the `RoomEnvironment.js` import list is normalized.
- No CDN is used at runtime; there is no npm installation or build step.

Official documentation: https://threejs.org/docs/pages/GLTFLoader and https://threejs.org/docs/pages/WebGLRenderer
