interface Group {
  minimum: number
  display_name: string
  org: string
  team_slug: string
}
export interface Settings {
  groups: Group[]
}

export interface Team {
  org: string
  team_slug: string
}

export interface TeamWithMembers extends Team {
  members: string[]
}

export interface SatisfactionResult {
  satisfied: boolean
  teams_to_request: Team[]
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
  private groups: Group[]

  constructor(
    settings: Settings,
    private approved_users: string[],
    private pr_owner: string,
    private requested_team_reviewers: string[],
    private existing_user_reviewers: string[],
    private expandedTeams: TeamWithMembers[]
  ) {
    this.messages = []
    this.meet_criteria = true

    if (settings.groups) {
      this.groups = settings.groups
    } else {
      throw Error('INVALID SETTINGS: No groups specified')
    }
  }

  async checkSatisfied(): Promise<SatisfactionResult> {
    const teams_to_request: Team[] = []
    // check if the groups criteria is met.
    const approved = new Set(this.approved_users)
    for (const group of this.groups) {
      const required_users = this.getRequiredReviewers(group)
      const approved_from_this_group = set_intersect(required_users, approved)

      if (group.minimum > approved_from_this_group.size) {
        this.meet_criteria = false
        this.messages.push(
          `${group.minimum} reviewers from the group '${
            group.display_name
          }' (${set_to_string(
            required_users
          )}) should approve this PR (currently: ${
            approved_from_this_group.size
          })`
        )

        if (
          set_intersect(required_users, new Set(this.existing_user_reviewers))
            .size === 0 &&
          !this.requested_team_reviewers.includes(group.team_slug)
        ) {
          teams_to_request.push(group)
        }
      }
    }

    return {
      satisfied: this.meet_criteria,
      teams_to_request
    }
  }

  getTeamMembers(org: string, team_slug: string): string[] | undefined {
    return this.expandedTeams.find(
      member => member.team_slug === team_slug && member.org === org
    )?.members
  }

  getRequiredReviewers(group: Group): Set<string> {
    const required_users = new Set(
      this.getTeamMembers(group.org, group.team_slug)
    )
    // Remove PR owner from required uesrs because PR owner cannot approve their own PR.
    required_users.delete(this.pr_owner)
    return required_users
  }

  getMessages(): string[] {
    return this.messages
  }
}
