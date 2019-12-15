import { ToolCommands as TerraformCommandHandlerAzureRM } from '../../../src/toolcmds';
import tl = require('azure-pipelines-task-lib');

let terraformCommandHandlerAzureRM: TerraformCommandHandlerAzureRM = new TerraformCommandHandlerAzureRM();

export async function run() {
    try {
        await terraformCommandHandlerAzureRM.validate();
    } catch(error) {
        tl.setResult(tl.TaskResult.Failed, 'AzureValidateFailInvalidWorkingDirectoryL0 should have succeeded but failed with error.');
    }
}

run();