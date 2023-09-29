import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks-types'
import * as fs from 'fs'
import * as YAML from 'yaml'
import {EOL} from 'os'
import {Settings, ReviewGatekeeper, Team} from './review-gatekeeper'

async function run(): Promise<void> {
  try {
    const context = github.context
    if (
      context.eventName !== 'pull_request' &&
      context.eventName !== 'pull_request_review'
    ) {
      core.setFailed(
        `Invalid event: ${context.eventName}. This action should be triggered on pull_request and pull_request_review`
      )
      return
    }

    if (context.payload.pull_request === undefined) {
      throw Error('Pull Request is Null')
    }

    const payload = context.payload as
      | Webhooks.PullRequestEvent
      | Webhooks.PullRequestReviewEvent

    // Read values from config file if it exists
    const config_file = fs.readFileSync(core.getInput('config-file'), 'utf8')

    // Parse contents of config file into variable
    const config_file_contents = YAML.parse(config_file)
    core.debug('Config file contents:')
    core.debug(config_file_contents)
    const settings = config_file_contents as Settings

    const token: string = core.getInput('token')
    const octokit = github.getOctokit(token)

    const reviews = await octokit.rest.pulls.listReviews({
      ...context.repo,
      pull_number: payload.pull_request.number
    })
    const approved_users: Set<string> = new Set()
    for (const review of reviews.data) {
      if (review.state === `APPROVED` && review.user) {
        approved_users.add(review.user.login)
      }
    }

    const requestedReviewers = (
      await octokit.rest.pulls.listRequestedReviewers({
        ...context.repo,
        pull_number: context.payload.pull_request.number
      })
    ).data.users.map(user => user.login)

    core.debug(`Requested reviewers: ${requestedReviewers}`)

    const existingReviewers = reviews.data
      .map(review => review?.user?.login ?? null)
      .filter(user => user !== null) as string[]

    core.debug(`Existing reviewers: ${existingReviewers}`)

    const flatFrom =
      settings.approvals &&
      (settings.approvals.groups
        ?.map(group => group.from)
        .flat()
        .filter(team => !!team) as string[])

    const expandedTeams = (
      await Promise.all(
        flatFrom
          .filter(team => team.startsWith('@'))
          .map(async team => {
            const [org, team_slug] = team.substring(1).split('/')
            core.debug(`Expanding team: '${org}' '${team_slug}'`)
            try {
              const members = await octokit.rest.teams.listMembersInOrg({
                org,
                team_slug
              })

              const memberLogins = members.data.map(
                member => member.login ?? ''
              )
              core.debug(`Members of ${team} expanded to: ${memberLogins}`)
              return {org, team_slug, members: memberLogins} as Team
            } catch (error) {
              if (error instanceof Error) {
                core.error(error)
              }
              return {org, team_slug, members: []} as Team
            }
          })
      )
    ).flat()

    core.debug(`Expanded teams: ${Array.from(approved_users)}`)

    const review_gatekeeper = new ReviewGatekeeper(
      settings,
      Array.from(approved_users),
      payload.pull_request.user.login,
      requestedReviewers,
      existingReviewers,
      expandedTeams
    )

    const sha = payload.pull_request.head.sha
    // The workflow url can be obtained by combining several environment varialbes, as described below:
    // https://docs.github.com/en/actions/reference/environment-variables#default-environment-variables
    const workflow_url = `${process.env['GITHUB_SERVER_URL']}/${process.env['GITHUB_REPOSITORY']}/actions/runs/${process.env['GITHUB_RUN_ID']}`
    const {satisfied, requests} = await review_gatekeeper.checkSatisfied()
    core.debug(`Satisfied: ${satisfied}`)
    core.info(`Setting a status on commit (${sha})`)

    octokit.rest.repos.createCommitStatus({
      ...context.repo,
      sha,
      state: satisfied ? 'success' : 'failure',
      context: 'PR Gatekeeper Status',
      target_url: workflow_url,
      description: satisfied
        ? undefined
        : review_gatekeeper.getMessages().join(' ').substring(0, 140)
    })

    if (!satisfied) {
      core.setFailed(review_gatekeeper.getMessages().join(EOL))
      if (
        requests.reviewers.length === 0 ||
        requests.team_reviewers.length === 0
      ) {
        octokit.rest.pulls.requestReviewers({
          ...context.repo,
          pull_number: payload.pull_request.number,
          reviewers: requests.reviewers,
          team_reviewers: requests.team_reviewers
        })
      }
      return
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error)
      core.error(error)
      core.error(error.stack?.toString() ?? '')
      throw error
    }
  }
}

run()
