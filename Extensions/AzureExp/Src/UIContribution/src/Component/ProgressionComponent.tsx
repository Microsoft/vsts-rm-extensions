import * as React from 'react';
import { ExperimentComponent } from './ExperimentComponent';
import { Card } from 'azure-devops-ui/Card';
import { TitleSize } from 'azure-devops-ui/Header';

export interface IProgressionComponentProps  { 
    progression: any;
    scorecards: any;
}

export default class ProgressionComponent extends React.Component<IProgressionComponentProps> {
    constructor(props: IProgressionComponentProps) {
        super(props);
    } 

    public render(): JSX.Element {
        let experiments = this.props.progression['Studies'].sort((a, b) => a.ExperimentTrialConfiguration.SequenceIndex - b.ExperimentTrialConfiguration.SequenceIndex).map((study: any) =>             
            <ExperimentComponent 
                experiment={study}
                scorecards={this.props.scorecards} />
        );
       
        return (
            <div className='progression'>
                <Card
                    titleProps={{
                        text: `Progression - ${this.props.progression.Name}`,
                        size: TitleSize.Medium
                    }}
                    contentProps={{
                        className: 'progression-card-content'
                    }}
                >
                    {experiments}    
                </Card>
            </div>
        );
    }
}