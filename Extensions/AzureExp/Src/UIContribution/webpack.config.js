var path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    entry: {
        experimentoverview: './src/ExperimentOverview.tsx'
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        devtoolModuleFilenameTemplate: 'webpack:///[absolute-resource-path]',
    },
    externals: [
        /^VSS\/.*/, /^TFS\/.*/, /^q$/,/^ReleaseManagement\/.*/,
    ],  
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json'],
        modules: [path.resolve('./src'), 'node_modules'],
        alias: {
            'azure-devops-extension-sdk': path.resolve('node_modules/azure-devops-extension-sdk')
        }
    },
    module: {
        rules: [{
            test: /\.tsx?$/,
            loader: 'ts-loader'
        },
        {
            test: /\.scss$/,
            use: ['style-loader', 'css-loader', 'azure-devops-ui/buildScripts/css-variables-loader', 'sass-loader']
        },
        {
            test: /\.css$/,
            use: ['style-loader', 'css-loader'],
        },
        {
            test: /\.woff$/,
            use: [{
                loader: 'base64-inline-loader'
            }]
        }]
    },
    plugins: [
        new CopyWebpackPlugin([{ from: 'src/*.html', flatten: true }])
    ]
};