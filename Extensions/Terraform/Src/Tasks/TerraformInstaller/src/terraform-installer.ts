import tasks = require('azure-pipelines-task-lib/task');
import tools = require('azure-pipelines-tool-lib/tool');
import path = require('path');
import os = require('os');
import fs = require('fs');

const uuidV4 = require('uuid/v4');
const terraformToolName = "terraform";
const isWindows = os.type().match(/^Win/);

export async function downloadTerraform(inputVersion: string): Promise<string> {
    let version = tools.cleanVersion(inputVersion);
    if (!version) {
        throw new Error(tasks.loc("InputVersionNotValidSemanticVersion", inputVersion));
    }

    let cachedToolPath = tools.findLocalTool(terraformToolName, version);
    if (!cachedToolPath) {
        let terraformDownloadUrl = getTerraformDownloadUrl(version);
        let fileName = `${terraformToolName}-${version}-${uuidV4()}.zip`;
        let terraformDownloadPath;

        try {
            terraformDownloadPath = await tools.downloadTool(terraformDownloadUrl, fileName);
        } catch (exception) {
            throw new Error(tasks.loc("TerraformDownloadFailed", terraformDownloadUrl, exception));
        }

        let terraformUnzippedPath = await tools.extractZip(terraformDownloadPath);
        cachedToolPath = await tools.cacheDir(terraformUnzippedPath, terraformToolName, version);
    }

    let terraformPath = findTerraformExecutable(cachedToolPath);
    if (!terraformPath) {
        throw new Error(tasks.loc("TerraformNotFoundInFolder", cachedToolPath));
    }

    if (!isWindows) {
        fs.chmodSync(terraformPath, "777");
    }

    tasks.setVariable('terraformLocation', terraformPath);

    return terraformPath;
}

function getTerraformDownloadUrl(version: string): string {
    let platform: string;
    let architecture: string;

    switch(os.type()) {
        case "Darwin":
            platform = "darwin";
            break;
        
        case "Linux":
            platform = "linux";
            break;
        
        case "Windows_NT":
            platform = "windows";
            break;
        
        default:
            throw new Error(tasks.loc("OperatingSystemNotSupported", os.type()));
    }

    switch(os.arch()) {
        case "x64":
            architecture = "amd64";
            break;
        
        case "x32":
            architecture = "386";
            break;
            
        case "arm":
            architecture = "arm";
            break;
        
        default:
            throw new Error(tasks.loc("ArchitectureNotSupported", os.arch()));
    }

    return `https://releases.hashicorp.com/terraform/${version}/terraform_${version}_${platform}_${architecture}.zip`;
}

function findTerraformExecutable(rootFolder: string): string {
    let terraformPath = path.join(rootFolder, terraformToolName + getExecutableExtension());
    var allPaths = tasks.find(rootFolder);
    var matchingResultFiles = tasks.match(allPaths, terraformPath, rootFolder);
    return matchingResultFiles[0];
}

function getExecutableExtension(): string {
    if (isWindows) {
        return ".exe";
    }

    return "";
}
