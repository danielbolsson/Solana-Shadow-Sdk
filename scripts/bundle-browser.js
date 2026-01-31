const esbuild = require('esbuild');
const path = require('path');
const { polyfillNode } = require('esbuild-plugin-polyfill-node');

async function bundle() {
    console.log('📦 Bundling Shadow SDK for browser...');

    try {
        await esbuild.build({
            entryPoints: [path.join(__dirname, '../packages/core/src/index.ts')],
            bundle: true,
            outfile: path.join(__dirname, '../web-dashboard/public/js/shadow-sdk.js'),
            format: 'iife',
            globalName: 'ShadowSDK',
            platform: 'browser',
            target: ['es2020'],
            sourcemap: true,
            define: {
                'process.env.NODE_ENV': '"production"',
                'global': 'window'
            },
            plugins: [
                polyfillNode({
                    globals: {
                        process: true,
                        Buffer: true
                    },
                    polyfills: {
                        assert: true,
                        crypto: true,
                        stream: true,
                        util: true,
                        path: true,
                    }
                })
            ]
        });
        console.log('✅ Build successful: web-dashboard/public/js/shadow-sdk.js');
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

bundle();
