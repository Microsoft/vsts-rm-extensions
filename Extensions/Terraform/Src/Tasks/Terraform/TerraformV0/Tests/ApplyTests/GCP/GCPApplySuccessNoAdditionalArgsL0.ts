import { ToolCommands as TerraformCommandHandlerGCP } from '../../../src/toolcmds';
import tl = require('azure-pipelines-task-lib');

let terraformCommandHandlerGCP: TerraformCommandHandlerGCP = new TerraformCommandHandlerGCP();

export async function run() {
    try {
        const response = await terraformCommandHandlerGCP.onlyApply();
        if (response === 0) {
            tl.setResult(tl.TaskResult.Succeeded, 'GCPApplySuccessNoAdditionalArgsL0 should have succeeded.');
        } else{
            tl.setResult(tl.TaskResult.Failed, 'GCPApplySuccessNoAdditionalArgsL0 should have succeeded but failed.');
        }
    } catch(error) {
        tl.setResult(tl.TaskResult.Failed, 'GCPApplySuccessNoAdditionalArgsL0 should have succeeded but failed.');
    }
}

run();