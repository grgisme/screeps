import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import clear from 'rollup-plugin-clear';

export default {
    input: 'src/main.ts',
    output: {
        file: 'dist/main.js',
        format: 'cjs',
        sourcemap: true,
        // Inject version banner at top of bundle for easy identification
        banner: '/* Screeps Bot - Built: ' + new Date().toISOString() + ' */',
    },
    external: ['lodash', 'source-map'],
    treeshake: {
        moduleSideEffects: false,  // Aggressive tree-shaking
        propertyReadSideEffects: false,
    },
    plugins: [
        clear({ targets: ['dist'] }),
        resolve({ extensions: ['.js', '.ts'] }),
        commonjs(),
        typescript({ tsconfig: './tsconfig.build.json' })
    ]
};
