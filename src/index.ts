import {Command, flags} from '@oclif/command';
import {prompt, QuestionCollection} from 'inquirer';
import {loadSharedConfigFiles} from '@aws-sdk/shared-ini-file-loader';
import {fromIni} from '@aws-sdk/credential-providers';
import {
  CodeCommitClient,
  CreateRepositoryCommand,
} from '@aws-sdk/client-codecommit';
import {
  copyFile,
  readFile,
  writeFile,
  mkdir,
  unlink,
  rename,
} from 'fs/promises';
import chalk from 'chalk';
import ora, {Ora} from 'ora';
import path from 'path';
import {GetCallerIdentityCommand, STSClient} from '@aws-sdk/client-sts';
import execa from 'execa';
import Handlebars from 'handlebars';

const greenBold = chalk.bold.greenBright;

const AWS_REGIONS = [
  'us-east-2',
  'us-east-1',
  'us-west-1',
  'us-west-2',
  'af-south-1',
  'ap-east-1',
  'ap-south-1',
  'ap-northeast-3',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ca-central-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-south-1',
  'eu-west-3',
  'eu-north-1',
  'me-south-1',
  'sa-east-1',
] as const;

class PipelineProjectTool extends Command {
  static description =
    'Scaffold opinionated AWS CodeCommit repository + AWS CDK pipeline';

  static flags = {
    verbose: flags.boolean({char: 'v'}),
  };

  async run() {
    const {flags} = this.parse(PipelineProjectTool);
    const profiles = await loadSharedConfigFiles();
    const profileNames = Object.keys(profiles.credentialsFile);

    const questions: QuestionCollection<{
      project_name: string;
      project_description: string;
      profile_name: string;
      project_region: string;
      bootstrapping_required: boolean;
      git_protocol: 'https://' | 'codecommit://' | 'ssh://';
    }> = [
      {
        type: 'input',
        name: 'project_name',
        message: "What's the project name? (kebab case format)",
        validate(value) {
          const pass = value.match(/^([a-z][a-z0-9]*)(-[a-z0-9]+)*$/);
          if (pass) {
            return true;
          }
          return 'Please enter a valid project name (e.g. my-pipeline-project)';
        },
      },
      {
        type: 'input',
        name: 'project_description',
        message: "What's the project description?",
      },
      {
        type: 'list',
        name: 'profile_name',
        message: 'Which AWS profile?',
        choices: profileNames,
      },
      {
        type: 'input',
        name: 'project_region',
        message: 'Which AWS region?',
        default: 'eu-west-1',
        validate(value) {
          const pass = AWS_REGIONS.includes(value);
          if (pass) {
            return true;
          }
          return 'Please enter a valid AWS region (e.g. eu-west-1)';
        },
      },
      {
        type: 'list',
        name: 'git_protocol',
        message: 'Which git connection protocol do you use?',
        choices: ['https://', 'codecommit://', 'ssh://'],
      },
      {
        type: 'confirm',
        name: 'bootstrapping_required',
        message: 'Does this region need bootstrapping?',
        default: false,
      },
    ];

    const {
      project_name,
      project_description,
      profile_name,
      project_region,
      bootstrapping_required,
      git_protocol,
    } = await prompt(questions);

    // Get Account ID associated with profile
    const stsClient = new STSClient({
      credentials: fromIni({profile: profile_name}),
    });
    const command = new GetCallerIdentityCommand({});
    const {Account: account_id} = await stsClient.send(command);

    if (!account_id) {
      throw new Error('Unable to retrieve AWS Account ID');
    }

    // Create project directory
    await spinnerWrap(`${greenBold('mkdir')} ${project_name}`, () =>
      mkdir(project_name),
    );

    // Change working directory to new folder
    process.chdir(project_name);

    // Run cdk init
    await spinnerWrap(`Running ${greenBold('npx cdk init')}`, () =>
      exec({
        command: 'npx cdk init --language typescript',
        logger: this.log,
        verbose: flags.verbose,
      }),
    );

    // Start pipeline code changes
    await spinnerWrap('Creating cdk pipeline code changes', async () => {
      // Modify cdk.json
      const cdkJson = await readFile(path.resolve('cdk.json'), 'utf-8');
      const parsedCdkJson = JSON.parse(cdkJson);
      await writeFile(
        path.resolve('cdk.json'),
        JSON.stringify(
          {
            ...parsedCdkJson,
            context: {
              ...parsedCdkJson.context,
              '@aws-cdk/core:newStyleStackSynthesis': true,
            },
          },
          null,
          2,
        ),
        'utf-8',
      );

      // Overwrite cdk bin
      await compileAndWriteFile({
        templatePath: path.join(__dirname, 'templates', 'bin', 'pipeline.ts'),
        templateContext: {
          project_name,
          project_region,
          account_id,
        },
        destinationPath: path.resolve('bin', `${project_name}.ts`),
      });

      // remove cdk lib stack
      await unlink(path.resolve('lib', `${project_name}-stack.ts`));

      // rename old test
      await rename(
        path.resolve('test', `${project_name}.test.ts`),
        path.resolve('test', `${project_name}.test.ts.OLD`),
      );

      // add cdk lib files
      await compileAndWriteFile({
        templatePath: path.join(
          __dirname,
          'templates',
          'lib',
          'pipeline-stack.ts',
        ),
        templateContext: {
          project_name,
          project_region,
          account_id,
        },
        destinationPath: path.resolve('lib', 'pipeline-stack.ts'),
      });
      await copyFile(
        path.join(__dirname, 'templates', 'lib', 'scheduled-lambda-stack.ts'),
        path.resolve('lib', 'scheduled-lambda-stack.ts'),
      );
      await copyFile(
        path.join(__dirname, 'templates', 'lib', 'lambda.ts'),
        path.resolve('lib', 'scheduled-lambda-stack.lambda.ts'),
      );
    });

    // Install deps
    await spinnerWrap('Installing missing dependencies', async spinner => {
      // Extract cdk version from package.json
      const packageJson = await readFile(path.resolve('package.json'), 'utf-8');
      const parsedPackageJson = JSON.parse(packageJson);
      const cdkVersion = parsedPackageJson.dependencies['@aws-cdk/core'];

      // Installing missing cdk packages
      await exec({
        command: `npm install --save --save-exact @aws-cdk/aws-lambda-nodejs@${cdkVersion} @aws-cdk/aws-events@${cdkVersion} @aws-cdk/aws-events-targets@${cdkVersion} @aws-cdk/pipelines@${cdkVersion} @aws-cdk/aws-codecommit@${cdkVersion}`,
        verbose: flags.verbose,
        logger: this.log,
      });
      spinner.text = 'Installing missing devDependencies';
      await exec({
        command: 'npm install --save-dev esbuild@0 @types/aws-lambda',
        verbose: flags.verbose,
        logger: this.log,
      });
    });

    // Git commit
    await spinnerWrap('Saving changes to git', async () => {
      await exec({
        command: 'git branch -m main',
        verbose: flags.verbose,
        logger: this.log,
      });
      await exec({
        command: 'git add .',
        verbose: flags.verbose,
        logger: this.log,
      });
      await exec({
        command: 'git commit -m "Create changes for cdk pipelines"',
        verbose: flags.verbose,
        logger: this.log,
        shell: true,
      });
    });

    // Create git repo
    await spinnerWrap('Creating CodeCommmit repo', async () => {
      const codeCommitClient = new CodeCommitClient({
        credentials: fromIni({profile: profile_name}),
        region: project_region,
      });
      const createRepositoryCommand = new CreateRepositoryCommand({
        repositoryName: project_name,
        repositoryDescription: project_description,
      });
      await codeCommitClient.send(createRepositoryCommand);
    });

    // Connect git remote
    await spinnerWrap('Connecting git remote', () =>
      exec({
        command: `git remote add origin ${createGitRemoteUrl({
          git_protocol,
          profile_name,
          project_name,
          project_region,
        })}`,
        verbose: flags.verbose,
        logger: this.log,
      }),
    );
    // Cant git push on http because it may ask for login details
    if (git_protocol !== 'https://') {
      await spinnerWrap('Pushing to remote', () =>
        exec({
          command: 'git push -u origin main',
          verbose: flags.verbose,
          logger: this.log,
        }),
      );
    }

    // Bootstrap region
    if (bootstrapping_required) {
      await spinnerWrap(`Bootstrapping ${project_region} region`, () =>
        exec({
          command: `env CDK_NEW_BOOTSTRAP=1 npx cdk bootstrap \
          --profile ${profile_name} \
          --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess \
          aws://${account_id}/${project_region}`,
          verbose: flags.verbose,
          logger: this.log,
        }),
      );
    }

    // Deploy pipeline
    if (git_protocol !== 'https://') {
      await spinnerWrap('Deploying pipeline!', () =>
        exec({
          command: `npx cdk deploy PipelineStack \
          --profile ${profile_name} \
          --require-approval=never`,
          verbose: flags.verbose,
          logger: this.log,
        }),
      );
      this.log(
        `CodePipeline URL: https://${project_region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${project_name}/view`,
      );
    } else {
      this.log('--- Final manual steps required: ---');
      this.log(`cd ${project_name}`);
      this.log('git push');
      this.log(
        `npx cdk deploy PipelineStack --profile ${profile_name} --require-approval=never`,
      );
    }
  }
}

const spinnerWrap = async (
  spinnerText: string,
  fn: (spinner: Ora) => Promise<any>,
) => {
  const spinner = ora(spinnerText).start();
  await fn(spinner);
  spinner.succeed();
};

const exec = async ({
  command,
  shell,
  logger,
  verbose,
}: {
  command: string;
  shell?: boolean;
  logger: Command['log'];
  verbose?: boolean;
}) => {
  const {stdout, stderr} = await execa.command(
    command,
    shell
      ? {
          shell: true,
        }
      : {},
  );
  if (verbose) {
    if (stdout) logger(stdout);
    if (stderr) logger(stderr);
  }
};

const createGitRemoteUrl = ({
  git_protocol,
  project_name,
  project_region,
  profile_name,
}: {
  project_name: string;
  profile_name: string;
  project_region: string;
  git_protocol: 'https://' | 'codecommit://' | 'ssh://';
}) => {
  switch (git_protocol) {
    case 'https://':
      return `https://git-codecommit.${project_region}.amazonaws.com/v1/repos/${project_name}`;
    case 'ssh://':
      return `ssh://git-codecommit.${project_region}.amazonaws.com/v1/repos/${project_name}`;
    case 'codecommit://':
      return `codecommit::${project_region}://${profile_name}@${project_name}`;
    default:
      throw new Error(`git_protocol "${git_protocol}" not recognised.`);
  }
};

const compileAndWriteFile = async ({
  templatePath,
  templateContext,
  destinationPath,
}: {
  templatePath: string;
  templateContext: Record<string, string>;
  destinationPath: string;
}) => {
  const templateString = await readFile(templatePath, 'utf-8');
  const template = Handlebars.compile(templateString);
  const compiled = template(templateContext);
  await writeFile(destinationPath, compiled, 'utf-8');
};

export = PipelineProjectTool;
