import * as tl from 'azure-pipelines-task-lib';
import * as path from 'path';
import ExperimentManager, { ExperimentAction } from './experimentmanager';

async function run() {
    try {
        tl.setResourcePath(path.join( __dirname, 'task.json'));

        let serviceConnectionId = tl.getInput('ServiceConnectionId', true);
        let featureId = tl.getInput('FeatureId', true);
        let progressionId = tl.getInput('ProgressionId', true);
        let action = tl.getInput('Action', true);
        let experimentName = ExperimentAction[action] !== ExperimentAction.StopAllExperiments ? tl.getInput('ExperimentName', true) : '';
        
        if (!ExperimentAction[action]) {
            throw new Error(tl.loc('InvalidAction', action));
        }

        let experimentmanager = new ExperimentManager(featureId, progressionId, serviceConnectionId, tl.getVariable('AZURE_HTTP_USER_AGENT'));
        let experiments = await experimentmanager.getExperiments(experimentName);

        if (ExperimentAction[action] === ExperimentAction.StopAllExperiments) {
            for (let experiment of experiments) {
                if (!ExperimentManager.IsExperimentStopped(experiment, true)) {
                    await experimentmanager.executeAction(ExperimentAction.Stop, experiment);
                }
                else {
                    console.log(tl.loc('ExperimentAlreadyStopped', experiment.Name));
                }
            }
        }
        else {
            if (experiments.length > 1) {
                throw new Error(tl.loc('MoreThanOneExperimentFound', experimentName));
            } 

            await experimentmanager.executeAction(ExperimentAction[action], experiments[0]);
        }
    }
    catch (error) {
        tl.setResult(tl.TaskResult.Failed, error);
    }
}

run();