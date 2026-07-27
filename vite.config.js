import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    var base = env.VITE_BASE_PATH || '/';
    return {
        plugins: [react()],
        base: base.endsWith('/') ? base : "".concat(base, "/"),
    };
});
