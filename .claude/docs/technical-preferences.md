# Technical Preferences

<!-- Populated by /setup-engine. Updated as the user makes decisions throughout development. -->
<!-- All agents reference this file for project-specific standards and conventions. -->

## Engine & Language

- **Engine**: Phaser 3.90.0
- **Language**: TypeScript
- **Rendering**: WebGL (Phaser.AUTO, falls back to Canvas)
- **Physics**: Phaser Arcade Physics (2D)

## Input & Platform

- **Target Platforms**: Web (HTML5, mobile H5 priority), PC
- **Input Methods**: Mouse/Keyboard, Touch (Mixed)
- **Primary Input**: Mouse/Keyboard (touch fallback for mobile)
- **Gamepad Support**: None (future option)
- **Touch Support**: Full (touch-friendly UI, no hover-reliant interactions)
- **Platform Notes**: Mobile-first responsive scaling. All UI elements must be touch-target sized (min 44x44px).

## Naming Conventions

- **Classes**: PascalCase (e.g., `PlayerController`)
- **Variables/functions**: camelCase (e.g., `moveSpeed`, `takeDamage`)
- **Events**: camelCase past tense (e.g., `healthChanged`)
- **Files**: PascalCase for classes (e.g., `PlayerController.ts`), camelCase for utilities
- **Scenes**: PascalCase (e.g., `MainMenu.ts`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_HEALTH`)

## Performance Budgets

- **Target Framerate**: 60 FPS
- **Frame Budget**: 16.6 ms
- **Draw Calls**: 200-300 (typical 2D game)
- **Memory Ceiling**: 512 MB (mobile browser) / 1 GB (desktop)

## Testing

- **Framework**: [TO BE CONFIGURED — suggest Vitest]
- **Minimum Coverage**: [TO BE CONFIGURED]
- **Required Tests**: Balance formulas, gameplay systems

## Forbidden Patterns

- [None configured yet — add as architectural decisions are made]

## Allowed Libraries / Addons

- [None configured yet — add as dependencies are approved]

## Architecture Decisions Log

- [No ADRs yet — use /architecture-decision to create one]

## Engine Specialists

- **Primary**: phaser-specialist (if available), otherwise use general-purpose with Phaser context
- **Language/Code Specialist**: general-purpose (TypeScript knowledge)
- **Shader Specialist**: N/A (Phaser uses no custom shaders beyond built-in)
- **UI Specialist**: general-purpose (Phaser scene + DOM UI mix)
- **Additional Specialists**: N/A
- **Routing Notes**: For Phaser-specific questions, prefer WebSearch or Context7.

### File Extension Routing

| File Extension / Type | Specialist to Spawn |
|-----------------------|---------------------|
| Game code (.ts files) | general-purpose |
| Scene / prefab (.ts scene files) | general-purpose |
| General architecture review | general-purpose |
