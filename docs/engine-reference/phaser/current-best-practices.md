# Phaser 3 — Current Best Practices (Post-Cutoff)

This document is based on Phaser 3.90.0 as of 2026-05-04.

## TypeScript Integration

Phaser 3 includes TypeScript definitions out of the box. Use `import * as Phaser from 'phaser'`.

```typescript
import Phaser from 'phaser';

class MainScene extends Phaser.Scene {
    constructor() {
        super('MainScene');
    }

    preload() {
        this.load.image('logo', 'assets/logo.png');
    }

    create() {
        this.add.image(400, 300, 'logo');
    }
}

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    scene: MainScene
};

new Phaser.Game(config);
```

## Vite Build Setup

Use `vite-plugin-phaser` or manual configuration:

```bash
npm create vite@latest my-game -- --template react-ts
cd my-game
npm install phaser
```

## Rendering

- `Phaser.AUTO` selects WebGL if available, falls back to Canvas
- For mobile, WebGL is strongly preferred

## Loading Assets

Use `this.load` in `preload()`. For dynamic loading at runtime, use `this.load` and listen to `this.load.on('complete')`.

## Scene Management

- Use `this.scene.start('SceneName')` to switch scenes
- Use `this.scene.launch('UIScene')` for overlay scenes

## Input Handling

- Keyboard: `this.input.keyboard.on('keydown-SPACE', callback)`
- Mouse: `this.input.on('pointerdown', callback)`
- Touch: same as mouse (pointer events work across both)

## Performance

- Limit texture sizes; use texture atlases
- Avoid creating/destroying many game objects per frame; use object pooling
- Use `this.time.delayedCall()` instead of `setTimeout`
