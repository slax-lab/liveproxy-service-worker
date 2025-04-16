import path from 'path';
import fs from 'fs';
import webpack from 'webpack';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class InjectScriptPlugin {
    apply(compiler) {
        compiler.hooks.beforeCompile.tapAsync('InjectScriptPlugin', (params, callback) => {
            console.log('building inject.ts...');

            const tempDir = path.resolve(__dirname, 'src/temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const injectCompiler = webpack({
                mode: 'production',
                entry: path.resolve(__dirname, 'src/inject.ts'),
                output: {
                    path: tempDir,
                    filename: 'inject.js',
                    library: {
                        type: 'module'
                    }
                },
                module: {
                    rules: [
                        {
                            test: /\.tsx?$/,
                            use: 'ts-loader',
                            exclude: /node_modules/
                        }
                    ]
                },
                resolve: {
                    extensions: ['.ts', '.js']
                },
                experiments: {
                    outputModule: true,
                },
                target: 'web',
                optimization: {
                    minimize: true
                }
            });

            injectCompiler.run((err, stats) => {
                if (err) {
                    console.error('building inject.ts error:', err);
                    return callback(err);
                }

                if (stats.hasErrors()) {
                    const error = stats.toJson().errors[0];
                    console.error('building inject.ts error:', error);
                    return callback(new Error(error));
                }

                try {
                    const injectPath = path.resolve(tempDir, 'inject.js');
                    const injectContent = fs.readFileSync(injectPath, 'utf8');

                    const rewritePath = path.resolve(__dirname, 'src/rewrite.ts');
                    let rewriteContent = fs.readFileSync(rewritePath, 'utf8');

                    rewriteContent = rewriteContent.replace(
                        /const\s+liveProxyCode\s*=\s*""\s*;/,
                        `const liveProxyCode = ${JSON.stringify(injectContent)};`
                    );

                    fs.writeFileSync(rewritePath, rewriteContent);

                    console.log('✅ inject.ts build success');
                    callback();
                } catch (error) {
                    console.error('inject.ts build error:', error);
                    callback(error);
                }
            });
        });

        compiler.hooks.done.tap('CleanupPlugin', (stats) => {
            const tempDir = path.resolve(__dirname, 'src/temp');
            if (fs.existsSync(tempDir)) {
                fs.rm(tempDir, { recursive: true, force: true }, (err) => {
                    if (err) {
                        console.error('cleaning temp dir error:', err);
                    } else {
                        console.log('✅ temp dir cleaned');
                    }
                });
            }

            try {
                const rewritePath = path.resolve(__dirname, 'src/rewrite.ts');
                let rewriteContent = fs.readFileSync(rewritePath, 'utf8');

                rewriteContent = rewriteContent.replace(
                    /const\s+liveProxyCode\s*=\s*.+;/,
                    'const liveProxyCode = "";'
                );

                fs.writeFileSync(rewritePath, rewriteContent);
                console.log('✅ rewrite.ts restored');
            } catch (error) {
                console.error('restore rewrite.ts error:', error);
            }
        });
    }
}

const config = {
    mode: 'production',
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'liveproxy-sw.js',
        globalObject: 'self'
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    plugins: [
        new InjectScriptPlugin()
    ],
    target: 'webworker'
};

export default config;