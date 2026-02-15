import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

export default {
    input: 'src/main.ts',
    output: {
        file: 'dist/main.js',
        format: 'cjs',
        sourcemap: true
    },
    external: ['lodash'],
    plugins: [
        resolve({ extensions: ['.js', '.ts'] }),
        commonjs(),
        typescript({ tsconfig: './tsconfig.build.json' })
    ]
};
