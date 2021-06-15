import * as Release from 'azure-devops-extension-api/Release';

export namespace Constants {
    export const PROVISION_EXPERIMENT_TASK_ID = '2e02b7a6-8222-4a82-9be3-faf7e3e757d3';
    export const MANAGE_EXPERIMENT_TASK_ID = '36e2b610-65b3-4882-a173-572a943990d3';
    export const FEATURE_ID_VARIABLE_NAME = 'FeatureId';
    export const PROGRESSION_ID_VARIABLE_NAME = 'ProgressionId';
    export const SERVICE_CONNECTION_ID_INPUT_NAME = 'ServiceConnectionId';
}

export default class ExpUtility {
    public static isOverviewTabVisible(context): boolean {
        // Show UI tab only if ProvisionExperiment/ManageExperiment tasks are available
        let tasksMap = this._getTasksByIdMap(context);
        return !!tasksMap[Constants.PROVISION_EXPERIMENT_TASK_ID] || !!tasksMap[Constants.MANAGE_EXPERIMENT_TASK_ID];
    }
    
    public static getFeatureAndProgressionIdFromRelease(release: Release.Release): [string, string] {
        let featureId = release.variables[Constants.FEATURE_ID_VARIABLE_NAME] && release.variables[Constants.FEATURE_ID_VARIABLE_NAME].value;
        let progressionId = release.variables[Constants.PROGRESSION_ID_VARIABLE_NAME] && release.variables[Constants.PROGRESSION_ID_VARIABLE_NAME].value;
        return [featureId, progressionId];
    }

    public static getServiceConnectionId(context) {
        let tasksMap = this._getTasksByIdMap(context);
        
        let provisionExperimentTasks = tasksMap[Constants.PROVISION_EXPERIMENT_TASK_ID];
        if (provisionExperimentTasks && provisionExperimentTasks.length > 0) {
            let serviceConnectionId = provisionExperimentTasks[0].inputs[Constants.SERVICE_CONNECTION_ID_INPUT_NAME];
            return serviceConnectionId;
        }

        let manageExperimentTasks = tasksMap[Constants.MANAGE_EXPERIMENT_TASK_ID];
        if (manageExperimentTasks && manageExperimentTasks.length > 0) {
            let serviceConnectionId = manageExperimentTasks[0].inputs[Constants.SERVICE_CONNECTION_ID_INPUT_NAME];
            return serviceConnectionId;
        }
    }

    public static removeDuplicateExperiments(experiments: any[]) {
        // group by experiment name
        let experimentsByNameMap: {[key: string]: any} = {};
        experiments.forEach((experiment: any) => {
            if (!experimentsByNameMap[experiment.Name]) {
                experimentsByNameMap[experiment.Name] = [];
            }

            experimentsByNameMap[experiment.Name].push(experiment);
        });

        // return a list of non-duplicate experiments
        let uniqueExperiments = [];
        for (let experimentName in experimentsByNameMap) {
            uniqueExperiments.push(this._getActiveExperiment(experimentsByNameMap[experimentName]));
        }

        return uniqueExperiments;
    }

    private static _getActiveExperiment(experiments: any[]) {
        // if there are multiple experiments due to multiple restarts, return the current active experiment  (last cloned)
        let activeExperiment = experiments.find((experiment: any) => experiment.RestartedFromId === null);
        let activeExperimentFound = false;
        while (!activeExperimentFound) {
            activeExperimentFound = true;
            for (let experiment of experiments) {
                if (experiment.RestartedFromId === activeExperiment.Id) {
                    activeExperiment = experiment;
                    activeExperimentFound = false;
                    break;
                }
            }
            
        }

        return activeExperiment;
    }

    private static _getTasksByIdMap(context) {
		let tasksByIdMap: {[key: string] : any[]} = {};
        if (!!context && context.releaseEnvironment) {
            let deployPhaseSnapshot = context.releaseEnvironment.deployPhasesSnapshot;
            if (!!deployPhaseSnapshot) {
                for (let deployPhase of deployPhaseSnapshot) {
                    let workFlowTasks = deployPhase.workflowTasks;
                    if (!!workFlowTasks) {
                        for (let workflowTask of workFlowTasks) {
                            if (!tasksByIdMap[workflowTask.taskId]) {
                                tasksByIdMap[workflowTask.taskId] = [];
                            }

                            tasksByIdMap[workflowTask.taskId].push(workflowTask);
                        }
                    }
                }
            }
        }

		return tasksByIdMap;
    }
}