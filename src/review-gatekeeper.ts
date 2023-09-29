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

export interface Team {
  org: string
  team_slug: string
  members: string[]
}

export interface SatisfactionResult {
  satisfied: boolean
  requests: ReviewersRequests
}

export interface ReviewersRequests {
  reviewers: string[]
  team_reviewers: string[]
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
    private requestedReviewers: string[],
    private existingReviewers: string[],
    private expandedTeams: Team[]
  ) {
    this.messages = []
    this.meet_criteria = true
  }

  async checkSatisfied(): Promise<SatisfactionResult> {
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
    const requests: ReviewersRequests[] = []
    // check if the groups criteria is met.
    const approved = new Set(this.approved_users)
    if (approvals.groups) {
      for (const group of approvals.groups) {
        const required_users = new Set(this.expandTeams(group.from))
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
          requests.push(this.getReviwersRequests(group))
        }
      }
    }
    return {
      satisfied: this.meet_criteria,
      requests: {
        reviewers: requests.flatMap(request => request.reviewers),
        team_reviewers: requests.flatMap(request => request.team_reviewers)
      }
    }
  }

  expandTeams(from: string[]): string[] {
    return from.flatMap(user => {
      if (!user.startsWith('@')) {
        return [user]
      }
      const [org, team_slug] = user.substring(1).split('/')

      return (
        this.expandedTeams.find(
          team => team.org === org && team.team_slug === team_slug
        )?.members ?? []
      )
    })
  }

  getReviwersRequests(group: Group): ReviewersRequests {
    const existingReviewersSet = new Set<string>(
      this.requestedReviewers.concat(this.existingReviewers)
    )
    core.info(`Existing Reviewers Set: ${Array.from(existingReviewersSet)}`)

    const neededTeamReviewers = group.from
      .filter(user => user.startsWith('@'))
      .map(user => {
        const [org, team_slug] = user.substring(1).split('/')
        return {org, team_slug}
      })
    core.info(
      `Needed Team Reviewers: ${neededTeamReviewers.map(
        team => team.team_slug
      )}`
    )

    const team_reviewers = neededTeamReviewers
      .filter(team => {
        const members = this.expandedTeams.find(
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

    return {reviewers, team_reviewers}
  }

  getMessages(): string[] {
    return this.messages
  }
}
