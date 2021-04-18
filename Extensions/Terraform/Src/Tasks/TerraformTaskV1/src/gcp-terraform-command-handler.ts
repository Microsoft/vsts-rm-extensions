import tasks = require('azure-pipelines-task-lib/task');
import {ToolRunner} from 'azure-pipelines-task-lib/toolrunner';
import {TerraformAuthorizationCommandInitializer} from './terraform-commands';
import {BaseTerraformCommandHandler} from './base-terraform-command-handler';
import path = require('path');
import * as uuidV4 from 'uuid/v4';

export class TerraformCommandHandlerGCP extends BaseTerraformCommandHandler {
    constructor() {
        super();
        this.providerName = "gcp";
    }

    private getJsonKeyFilePath(serviceName: string) {
        // Get credentials for json file
        const jsonKeyFilePath = path.resolve(`credentials-${uuidV4()}.json`);

        let clientEmail = tasks.getEndpointAuthorizationParameter(serviceName, "Issuer", false);
        let tokenUri = tasks.getEndpointAuthorizationParameter(serviceName, "Audience", false);
        let privateKey = tasks.getEndpointAuthorizationParameter(serviceName, "PrivateKey", false);

        // Create json string and write it to the file
        let jsonCredsString = `{"type": "service_account", "private_key": "${privateKey}", "client_email": "${clientEmail}", "token_uri": "${tokenUri}"}`
        tasks.writeFile(jsonKeyFilePath, jsonCredsString);

        return jsonKeyFilePath;
    }

    private setupBackend(backendServiceName: string) {
        this.backendConfig.set('bucket', tasks.getInput("backendGCPBucketName", true));
        this.backendConfig.set('prefix', tasks.getInput("backendGCPPrefix", false));

        let jsonKeyFilePath = this.getJsonKeyFilePath(backendServiceName);

        this.backendConfig.set('credentials', jsonKeyFilePath);
    }

    public handleBackend(terraformToolRunner: ToolRunner): void {
        let backendServiceName = tasks.getInput("backendServiceGCP", true);
        this.setupBackend(backendServiceName);

        for (let [key, value] of this.backendConfig.entries()) {
            terraformToolRunner.arg(`-backend-config=${key}=${value}`);
        }
    }

    public handleProvider(command: TerraformAuthorizationCommandInitializer) {
        if (command.serviceProvidername) {
            let jsonKeyFilePath = this.getJsonKeyFilePath(command.serviceProvidername);

            process.env['GOOGLE_APPLICATION_CREDENTIALS']  = `${jsonKeyFilePath}`;
            process.env['GOOGLE_PROJECT']  = tasks.getEndpointDataParameter(command.serviceProvidername, "project", false);            
        }
    }
}