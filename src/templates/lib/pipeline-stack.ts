import {Construct, Stack, StackProps, Stage, StageProps} from '@aws-cdk/core';
import * as pipelines from '@aws-cdk/pipelines';
import * as codecommit from '@aws-cdk/aws-codecommit';
import {ScheduledLambdaStack} from './scheduled-lambda-stack';

export default class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const repository = codecommit.Repository.fromRepositoryName(
      this,
      'Repository',
      '{{project_name}}',
    );

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      synth: new pipelines.ShellStep('Synth', {
        input: pipelines.CodePipelineSource.codeCommit(repository, 'main'),
        commands: ['npm ci', 'npm run build', 'npx cdk synth'],
      }),
      pipelineName: '{{project_name}}',
    });

    pipeline.addStage(
      new ApplicationStage(this, 'Stag', {
        env: {
          account: '{{account_id}}',
          region: '{{project_region}}',
        },
      }),
    );

    pipeline.addStage(
      new ApplicationStage(this, 'Prod', {
        env: {
          account: '{{account_id}}',
          region: '{{project_region}}',
        },
      }),
      {
        pre: [new pipelines.ManualApprovalStep('PromoteToProd')],
      },
    );
  }
}

class ApplicationStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    new ScheduledLambdaStack(this, 'ScheduledLambdaStack', {
      stackName: `{{project_name}}-${id.toLowerCase()}`,
    });
  }
}
