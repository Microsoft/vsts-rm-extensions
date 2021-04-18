import {TerraformToolHandler, ITerraformToolHandler} from './terraform';
import {ToolRunner, IExecOptions, IExecSyncOptions, IExecSyncResult} from 'azure-pipelines-task-lib/toolrunner';
import {TerraformBaseCommandInitializer, TerraformAuthorizationCommandInitializer} from './terraform-commands';
import tasks = require('azure-pipelines-task-lib/task');
import path = require('path');
import * as uuidV4 from 'uuid/v4';
const fs = require('fs');

export abstract class BaseTerraformCommandHandler {
    providerName: string;
    terraformToolHandler: ITerraformToolHandler;
    backendConfig: Map<string, string>;

    abstract handleBackend(terraformToolRunner: ToolRunner);
    abstract handleProvider(command: TerraformAuthorizationCommandInitializer);
    
    constructor() {
        this.providerName = "";
        this.terraformToolHandler = new TerraformToolHandler(tasks);
        this.backendConfig = new Map<string, string>();
    }

    public compareVersions(version1: string, version2: string) {
        let versionNumbers1: string[] = version1.split('.');
        let versionNumbers2: string[] = version2.split('.');

        const smallerLength = Math.min(versionNumbers1.length, versionNumbers2.length);
        
        let versionNumbersInt1: number[] = new Array(smallerLength);
        let versionNumbersInt2: number[] = new Array(smallerLength);
        
        for (let i = 0; i < smallerLength; i++) {
            versionNumbersInt1[i] = parseInt(versionNumbers1[i], 10);
            versionNumbersInt2[i] = parseInt(versionNumbers2[i], 10);
            if (versionNumbersInt1[i] > versionNumbersInt2[i]) return 1;
            if (versionNumbersInt1[i] < versionNumbersInt2[i]) return -1;        
        }

        return versionNumbersInt1.length == versionNumbersInt2.length ? 0: (versionNumbersInt1.length < versionNumbersInt2.length ? -1 : 1);
    }

    public warnIfMultipleProviders(): void {
        let terraformPath;
        try {
            terraformPath = tasks.which("terraform", true);
        } catch(err) {
            throw new Error(tasks.loc("TerraformToolNotFound"));
        }

        let terraformToolRunner: ToolRunner = tasks.tool(terraformPath);
        terraformToolRunner.arg("providers");
        let commandOutput = terraformToolRunner.execSync(<IExecSyncOptions>{
            cwd: tasks.getInput("workingDirectory")
        });

        let countProviders = (commandOutput.stdout.match(/provider/g) || []).length;
        tasks.debug(countProviders.toString());
        if (countProviders > 1) {
            tasks.warning("Multiple provider blocks specified in the .tf files in the current working drectory.");
        }
    }

    public getServiceProviderNameFromProviderInput(): string {
        let provider: string = tasks.getInput("provider", true);
        
        switch (provider) {
            case "azurerm": return "AzureRM";
            case "aws"    : return "AWS";
            case "gcp"    : return "GCP";
        }
    }

    public async init(): Promise<number> {
        let initCommand = new TerraformBaseCommandInitializer(
            "init",
            tasks.getInput("workingDirectory"),
            tasks.getInput("commandOptions")
        );
        
        let terraformTool;
        
        terraformTool = this.terraformToolHandler.createToolRunner(initCommand);
        this.handleBackend(terraformTool);
        
        return terraformTool.exec(<IExecOptions> {
            cwd: initCommand.workingDirectory
        });
    }

    protected checkIfShowCommandSupportsJsonOutput(): number {
        let terraformPath;
        try {
            terraformPath = tasks.which("terraform", true);
        } catch(err) {
            throw new Error(tasks.loc("TerraformToolNotFound"));
        }
        
        let terraformToolRunner: ToolRunner = tasks.tool(terraformPath);
        terraformToolRunner.arg("version");

        let outputContents = terraformToolRunner.execSync(<IExecSyncOptions>{
            cwd: tasks.getInput("workingDirectory")
        }).stdout;

        let outputLines: string[] = outputContents.split('\n');
        // First line has the format "Terraform v0.12.1"
        let firstLine = outputLines[0];
        // Extract only the version information from the first line i.e. "0.12.1"
        let currentVersion = firstLine.substring(11);
        // Check to see if this version is greater than or equal to 0.12.0
        return this.compareVersions(currentVersion, "0.12.0");
    }

    public async onlyPlan(): Promise<number> {
        this.warnIfMultipleProviders();
        let serviceName = `environmentServiceName${this.getServiceProviderNameFromProviderInput()}`;
        let planCommand = new TerraformAuthorizationCommandInitializer(
            "plan",
            tasks.getInput("workingDirectory"),
            tasks.getInput(serviceName, true),
            `${tasks.getInput("commandOptions")} -detailed-exitcode`
        );
        
        let terraformTool;
        terraformTool = this.terraformToolHandler.createToolRunner(planCommand);
        this.handleProvider(planCommand);
    
        return terraformTool.exec(<IExecOptions> {
            cwd: planCommand.workingDirectory
        });
    }

    public setOutputVariableToPlanFilePath() {
        // Do terraform version to check if version is >= 0.12.0
        if (this.checkIfShowCommandSupportsJsonOutput() >= 0) {
            let terraformTool;
            let fileStream;

            // Do terraform plan with -out flag to output the binary plan file
            const binaryPlanFilePath = path.resolve(`plan-binary-${uuidV4()}.tfplan`);
            const tempFileForPlanOutput = path.resolve(`temp-plan-${uuidV4()}.txt`);

            let serviceName = `environmentServiceName${this.getServiceProviderNameFromProviderInput()}`;
            let planCommand = new TerraformAuthorizationCommandInitializer(
                "plan",
                tasks.getInput("workingDirectory"),
                tasks.getInput(serviceName, true),
                `${tasks.getInput("commandOptions")} -out=${binaryPlanFilePath}`
            );
            terraformTool = this.terraformToolHandler.createToolRunner(planCommand);
            this.handleProvider(planCommand);
            fileStream = fs.createWriteStream(tempFileForPlanOutput);
            terraformTool.execSync(<IExecSyncOptions>{
                cwd: planCommand.workingDirectory,
                outStream: fileStream
            });

            // Do terraform show with -json flag to output the json plan file
            const jsonPlanFilePath = path.resolve(`plan-json-${uuidV4()}.json`);
            const tempFileForJsonPlanOutput = path.resolve(`temp-plan-json-${uuidV4()}.json`)
            let commandOutput: IExecSyncResult;
            let showCommand = new TerraformBaseCommandInitializer(
                "show",
                tasks.getInput("workingDirectory"),
                `-json ${binaryPlanFilePath}`
            );
            terraformTool = this.terraformToolHandler.createToolRunner(showCommand);
            fileStream = fs.createWriteStream(tempFileForJsonPlanOutput);
            commandOutput = terraformTool.execSync(<IExecSyncOptions>{
                cwd: showCommand.workingDirectory,
                outStream: fileStream
            });

            // Write command output to the json plan file
            tasks.writeFile(jsonPlanFilePath, commandOutput.stdout);
            // Set the output variable to the json plan file path
            tasks.setVariable('jsonPlanFilePath', jsonPlanFilePath);

            // Delete all the files that are not needed any further
            if (tasks.exist(binaryPlanFilePath)) {
                tasks.rmRF(binaryPlanFilePath);
            }

            if (tasks.exist(tempFileForPlanOutput)) {
                tasks.rmRF(tempFileForPlanOutput);
            }

            if (tasks.exist(tempFileForJsonPlanOutput)) {
                tasks.rmRF(tempFileForJsonPlanOutput);
            }

        } else {
            tasks.warning("Terraform show command does not support -json flag for terraform versions older than 0.12.0. The output variable named 'jsonPlanFilePath' was not set.")
        }
    }

    public async plan(): Promise<number> {
        await this.onlyPlan();
        tasks.setVariable('changesPresent', exitCode === 2);
        this.setOutputVariableToPlanFilePath();

        return Promise.resolve(0);
    }

    public async onlyApply(): Promise<number> {
        let terraformTool;
        this.warnIfMultipleProviders();
        let validateCommand = new TerraformBaseCommandInitializer("validate", tasks.getInput("workingDirectory"), '');
        terraformTool = this.terraformToolHandler.createToolRunner(validateCommand);
        await terraformTool.exec(<IExecOptions> {
            cwd: validateCommand.workingDirectory
        });
        
        let serviceName = `environmentServiceName${this.getServiceProviderNameFromProviderInput()}`;
        let autoApprove: string = '-auto-approve';
        let additionalArgs: string = tasks.getInput("commandOptions") || autoApprove;

        if (additionalArgs.includes(autoApprove) === false) {
            additionalArgs = `${autoApprove} ${additionalArgs}`;
        }

        let applyCommand = new TerraformAuthorizationCommandInitializer(
            "apply",
            tasks.getInput("workingDirectory"),
            tasks.getInput(serviceName, true),
            additionalArgs
        );

        terraformTool = this.terraformToolHandler.createToolRunner(applyCommand);
        this.handleProvider(applyCommand);

        return terraformTool.exec(<IExecOptions> {
            cwd: applyCommand.workingDirectory
        });
    }

    public setOutputVariableToJsonOutputVariablesFilesPath() {
        let additionalArgs: string = `-json`
        let outputCommand = new TerraformBaseCommandInitializer(
            "output",
            tasks.getInput("workingDirectory"),
            additionalArgs
        );

        let terraformTool;
        terraformTool = this.terraformToolHandler.createToolRunner(outputCommand);

        const jsonOutputVariablesFilePath = path.resolve(`output-${uuidV4()}.json`);
        const tempFileForJsonOutputVariables = path.resolve(`temp-output-${uuidV4()}.json`);
        const fileStream = fs.createWriteStream(tempFileForJsonOutputVariables);
        let commandOutput = terraformTool.execSync(<IExecSyncOptions>{
            cwd: outputCommand.workingDirectory,
            outStream: fileStream
        });

        tasks.writeFile(jsonOutputVariablesFilePath, commandOutput.stdout);
        tasks.setVariable('jsonOutputVariablesPath', jsonOutputVariablesFilePath);

        // Delete the temp file as it is not needed further
        if (tasks.exist(tempFileForJsonOutputVariables)) {
            tasks.rmRF(tempFileForJsonOutputVariables);
        }
    }

    public async apply(): Promise<number> {
        await this.onlyApply();
        this.setOutputVariableToJsonOutputVariablesFilesPath();

        return Promise.resolve(0);
    };

    public async destroy(): Promise<number> {
        this.warnIfMultipleProviders();
        let serviceName = `environmentServiceName${this.getServiceProviderNameFromProviderInput()}`;
        let autoApprove: string = '-auto-approve';
        let additionalArgs: string = tasks.getInput("commandOptions") || autoApprove;

        if (additionalArgs.includes(autoApprove) === false) {
            additionalArgs = `${autoApprove} ${additionalArgs}`;
        }

        let destroyCommand = new TerraformAuthorizationCommandInitializer(
            "destroy",
            tasks.getInput("workingDirectory"),
            tasks.getInput(serviceName, true),
            additionalArgs
        );

        let terraformTool;
        terraformTool = this.terraformToolHandler.createToolRunner(destroyCommand);
        this.handleProvider(destroyCommand);

        return terraformTool.exec(<IExecOptions> {
            cwd: destroyCommand.workingDirectory
        });
    };

    public async validate(): Promise<number> {
        let validateCommand = new TerraformBaseCommandInitializer(
            "validate",
            tasks.getInput("workingDirectory"),
            tasks.getInput("commandOptions")
        );

        let terraformTool;
        terraformTool = this.terraformToolHandler.createToolRunner(validateCommand);

        return terraformTool.exec(<IExecOptions>{
            cwd: validateCommand.workingDirectory
        });
    }
}
