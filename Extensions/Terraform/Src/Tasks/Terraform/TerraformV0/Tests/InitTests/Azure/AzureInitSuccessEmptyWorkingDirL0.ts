import { ToolCommands as TerraformCommandHandlerAzureRM } from '../../../src/toolcmds';
import tl = require('azure-pipelines-task-lib');

let terraformCommandHandlerAzureRM: TerraformCommandHandlerAzureRM = new TerraformCommandHandlerAzureRM();

export async function run() {
    try {
        const response = await terraformCommandHandlerAzureRM.init();
        if (response === 0) {
            tl.setResult(tl.TaskResult.Succeeded, 'AzureInitSuccessEmptyWorkingDirL0 should have succeeded.');
        } else{
            tl.setResult(tl.TaskResult.Failed, 'AzureInitSuccessEmptyWorkingDirL0 should have succeeded but failed.');
        }
    } catch(error) {
        tl.setResult(tl.TaskResult.Failed, 'AzureInitSuccessEmptyWorkingDirL0 should have succeeded but failed.');
    }
}

run();