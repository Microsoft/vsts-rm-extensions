import tasks = require('azure-pipelines-task-lib/task');
import {ToolRunner} from 'azure-pipelines-task-lib/toolrunner';
import {TerraformAuthorizationCommandInitializer} from './terraform-commands';
import {BaseTerraformCommandHandler} from './base-terraform-command-handler';

export class TerraformCommandHandlerAzureRM extends BaseTerraformCommandHandler {
    constructor() {
        super();
        this.providerName = "azurerm";
    }

    private setupBackend(backendServiceName: string) {
        this.backendConfig.set('storage_account_name', tasks.getInput("backendAzureRmStorageAccountName", true));
        this.backendConfig.set('container_name', tasks.getInput("backendAzureRmContainerName", true));
        this.backendConfig.set('key', tasks.getInput("backendAzureRmKey", true));
        this.backendConfig.set('resource_group_name', tasks.getInput("backendAzureRmResourceGroupName", true));
        this.backendConfig.set('subscription_id', tasks.getEndpointDataParameter(backendServiceName, "subscriptionid", true));
        this.backendConfig.set('tenant_id', tasks.getEndpointAuthorizationParameter(backendServiceName, "tenantid", true));
        this.backendConfig.set('client_id', tasks.getEndpointAuthorizationParameter(backendServiceName, "serviceprincipalid", true));
        this.backendConfig.set('client_secret', tasks.getEndpointAuthorizationParameter(backendServiceName, "serviceprincipalkey", true));
    }

    public handleBackend(terraformToolRunner: ToolRunner): void {
        let backendServiceName = tasks.getInput("backendServiceArm", true);
        this.setupBackend(backendServiceName);

        for (let [key, value] of this.backendConfig.entries()) {
            terraformToolRunner.arg(`-backend-config=${key}=${value}`);
        }
    }

    public handleProvider(command: TerraformAuthorizationCommandInitializer) {
        if (command.serviceProvidername) {
            process.env['SUBSCRIPTION_ID']  = tasks.getEndpointDataParameter(command.serviceProvidername, "subscriptionid", false);
            process.env['TENANT_ID']        = tasks.getEndpointAuthorizationParameter(command.serviceProvidername, "tenantid", false);
            process.env['CLIENT_ID']        = tasks.getEndpointAuthorizationParameter(command.serviceProvidername, "serviceprincipalid", false);
            process.env['CLIENT_SECRET']    = tasks.getEndpointAuthorizationParameter(command.serviceProvidername, "serviceprincipalkey", false);
        }
    }
}
