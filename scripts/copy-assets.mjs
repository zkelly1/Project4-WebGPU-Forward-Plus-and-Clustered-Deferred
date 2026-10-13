import { cpSync } from 'node:fs';
cpSync('scenes', 'dist/scenes', { recursive: true });
cpSync('img/demo.webm', 'dist/demo.webm');
