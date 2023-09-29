import {GitHub} from '@actions/github/lib/utils'
import {context} from '@actions/github'
import * as core from '@actions/core'

interface Group {
  minimum?: number
  name: string
  from: string[]
}
export interface Settings {
  approvals: {
    minimum?: number
    groups?: Group[]
  }
}

function set_equal<T>(as: Set<T>, bs: Set<T>): boolean {
  if (as.size !== bs.size) {
    return false
  }
  for (const a of as) {
    if (!bs.has(a)) {
      return false
    }
  }
  return true
}

function set_intersect<T>(as: Set<T>, bs: Set<T>): Set<T> {
  return new Set([...as].filter(e => bs.has(e)))
}

function set_to_string<T>(as: Set<T>): string {
  return [...as].join(', ')
}

export class ReviewGatekeeper {
  private messages: string[]
  private meet_criteria: boolean

  constructor(
    private settings: Settings,
    private approved_users: string[],
    private pr_owner: string,
    private octokit: InstanceType<typeof GitHub>
  ) {
    this.messages = []
    this.meet_criteria = true
  }

  async checkSatisfied(): Promise<boolean> {
    const approvals = this.settings.approvals
    // check if the minimum criteria is met.
    if (approvals.minimum) {
      if (approvals.minimum > this.approved_users.length) {
        this.meet_criteria = false
        this.messages.push(
          `${approvals.minimum} reviewers should approve this PR (currently: ${this.approved_users.length})`
        )
      }
    }

    // check if the groups criteria is met.
    const approved = new Set(this.approved_users)
    if (approvals.groups) {
      for (const group of approvals.groups) {
        const required_users = new Set(await this.expandTeams(group.from))
        // Remove PR owner from required uesrs because PR owner cannot approve their own PR.
        required_users.delete(this.pr_owner)
        const approved_from_this_group = set_intersect(required_users, approved)
        const minimum_of_group = group.minimum
        if (minimum_of_group) {
          if (minimum_of_group > approved_from_this_group.size) {
            this.meet_criteria = false
            this.messages.push(
              `${minimum_of_group} reviewers from the group '${
                group.name
              }' (${set_to_string(
                required_users
              )}) should approve this PR (currently: ${
                approved_from_this_group.size
              })`
            )
          }
        } else {
          // If no `minimum` option is specified, approval from all is required.
          if (!set_equal(approved_from_this_group, required_users)) {
            this.meet_criteria = false
            this.messages.push(
              `All of the reviewers from the group '${
                group.name
              }' (${set_to_string(required_users)}) should approve this PR`
            )
          }
        }

        if (!this.meet_criteria) {
          await this.requestReview(group)
        }
      }
    }
    return this.meet_criteria
  }

  async expandTeams(from: string[]): Promise<string[]> {
    return (
      await Promise.all(
        from.map(async team => {
          if (team.startsWith('@')) {
            const [org, team_slug] = team.substring(1).split('/')
            const members = await this.listMembers(org, team_slug)
            core.info(`Members of ${team} expanded to: ${members}`)
            return members
          } else {
            return [team]
          }
        })
      )
    ).flat()
  }

  async listMembers(org: string, team_slug: string): Promise<string[]> {
    const members = await this.octokit.rest.teams.listMembersInOrg({
      org,
      team_slug
    })
    return members.data.map(member => member.login ?? '')
  }

  async requestReview(group: Group): Promise<void> {
    if (context.payload.pull_request === undefined) {
      throw Error('Pull Request Number is Null')
    }

    const requestedReviewers = (
      await this.octokit.rest.pulls.listRequestedReviewers({
        ...context.repo,
        pull_number: context.payload.pull_request.number
      })
    ).data.users.map(user => user.login)

    core.info(`Requested Reviewers: ${requestedReviewers}`)

    const existingReviewers = (
      await this.octokit.rest.pulls.listReviews({
        ...context.repo,
        pull_number: context.payload.pull_request.number
      })
    ).data
      .map(review => review?.user?.login ?? null)
      .filter(user => user !== null) as string[]

    core.info(`Existing Reviewers: ${existingReviewers}`)

    const existingReviewersSet = new Set<string>(
      requestedReviewers.concat(existingReviewers)
    )
    core.info(`Existing Reviewers Set: ${existingReviewersSet}`)

    const neededTeamReviewers = group.from
      .filter(user => user.startsWith('@'))
      .map(user => {
        const [org, team_slug] = user.substring(1).split('/')
        return {org, team_slug}
      })
    core.info(`Needed Team Reviewers: ${neededTeamReviewers}`)

    const teamReviewerMembers = await Promise.all(
      neededTeamReviewers.map(async team => {
        const members = await this.listMembers(team.org, team.team_slug)
        return {team_slug: team.team_slug, members}
      })
    )
    core.info(`Team Reviewer Members: ${teamReviewerMembers}`)

    const team_reviewers = neededTeamReviewers
      .filter(team => {
        const members = teamReviewerMembers.find(
          member => member.team_slug === team.team_slug
        )?.members
        if (members === undefined) {
          return false
        }
        return members.some(member => !existingReviewersSet.has(member))
      })
      .map(team => team.team_slug)

    core.info(`Team Reviewers: ${team_reviewers}`)

    const reviewers = group.from.filter(user => {
      if (!user.startsWith('@')) {
        return !existingReviewersSet.has(user)
      }
    })

    core.info(`Reviewers: ${reviewers}`)

    await this.octokit.rest.pulls.requestReviewers({
      ...context.repo,
      pull_number: context.payload.pull_request.number,
      reviewers,
      team_reviewers
    })
  }

  getMessages(): string[] {
    return this.messages
  }
}
