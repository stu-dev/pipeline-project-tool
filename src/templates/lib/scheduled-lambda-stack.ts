import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {
  aws_lambda_nodejs as lambda,
  aws_events as events,
  aws_events_targets as targets,
} from 'aws-cdk-lib';

export class ScheduledLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const lambdaFn = new lambda.NodejsFunction(this, 'lambda');

    // Run 6:00 PM UTC every Monday through Friday
    // See https://docs.aws.amazon.com/lambda/latest/dg/tutorial-scheduled-events-schedule-expressions.html
    const rule = new events.Rule(this, 'Rule', {
      schedule: events.Schedule.expression('cron(0 18 ? * MON-FRI *)'),
    });

    rule.addTarget(new targets.LambdaFunction(lambdaFn));
  }
}
