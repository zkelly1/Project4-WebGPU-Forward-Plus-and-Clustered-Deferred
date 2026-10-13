import { defineConfig } from 'vite';
import { writeFile, mkdir } from 'node:fs/promises';
// Local-only validation server: disables HMR during long measurements and recordings.
export default defineConfig({
    server: { host: '127.0.0.1', port: 5174, hmr: false },
    plugins: [{ name: 'save-validation-artifacts', configureServer(server) {
        const files: Record<string, string> = {
            '/__artifacts/benchmark': 'results/benchmark.json',
            '/__artifacts/video': 'img/demo.webm',
            '/__artifacts/still': 'img/clustered-deferred.png'
        };
        server.middlewares.use(async (req, res, next) => {
            const path = files[req.url ?? ''];
            if (!path) return next();
            if (req.method !== 'POST' || req.headers.origin !== 'http://127.0.0.1:5174') {
                res.statusCode = 403; res.end(); return;
            }
            try {
                const chunks: Buffer[] = []; let size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > 64 * 1024 * 1024) throw new Error('Artifact too large');
                    chunks.push(chunk);
                }
                await mkdir(path.split('/')[0], { recursive: true });
                await writeFile(path, Buffer.concat(chunks));
                res.end('Saved');
            } catch { res.statusCode = 500; res.end('Save failed'); }
        });
    } }]
});
