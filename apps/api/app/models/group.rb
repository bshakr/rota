# A tenant. Maps 1:1 onto a WorkOS Organization, which is the source of truth for admin identity.
# Members and rotas are never stored in WorkOS.
class Group < ApplicationRecord
  include JitProvisioning

  # Rotas are destroyed before members on purpose: shifts point at members with a NOT NULL foreign
  # key, and Member refuses to be destroyed while any shift still names it. Clearing the rotas
  # clears their shifts, which is what frees the members to go.
  has_many :rotas, dependent: :destroy
  has_many :members, dependent: :destroy
  has_many :group_admins, dependent: :destroy
  has_many :admins, through: :group_admins, source: :user

  # A shift belongs to a rota, and a rota to a group, so a group's shifts are its rotas' shifts.
  # This is the seam the admin API scopes a single shift through — `group_scope(:shifts).find(id)`
  # — so a cross-tenant shift id can never be reached (see Api::ShiftsController, TenantScoped).
  has_many :shifts, through: :rotas
  # Every text names a member, and every member belongs to a group, so the delivery log scopes
  # cleanly through members — a group only ever sees its own house's texts.
  has_many :sms_messages, through: :members

  # The house's shared calendar, if an admin connected one (BLO-1667). Destroying the group takes the
  # link and every synced event with it.
  has_one :calendar_connection, dependent: :destroy

  validates :workos_organization_id, presence: true, uniqueness: true
  validates :name, presence: true
  before_validation :assign_slug, on: :create
  validates :slug, presence: true, uniqueness: true, format: { with: /\A[a-z0-9]+(?:-[a-z0-9]+)*\z/ }, length: { maximum: 80 }
  attr_readonly :slug
  validates :timezone, presence: true
  validate :timezone_must_be_recognised

  # Every house that is not paused. NULL `suspended_at` is the live state, so this is what the
  # recurring jobs merge in — `Rota.active.joins(:group).merge(Group.live)` — and it is deliberately
  # a scope here rather than a condition spelled out at each call site. There is one definition of
  # "still running", and a loop that forgot to apply it is a house that goes on being texted after
  # an operator paused it.
  scope :live, -> { where(suspended_at: nil) }

  # The group's wall clock. The reminder sweep computes each shift's send moment as `send_hour` in
  # *this* zone, which is what makes a 9am reminder still arrive at 9am after the clocks change.
  def time_zone
    ActiveSupport::TimeZone[timezone]
  end

  # The group's own calendar date — what "today" means in this house.
  #
  # `Date.current` is UTC here (config.time_zone), and every question of the form "is this shift in
  # the future?" gets a wrong answer from it in both directions. At 23:00 UTC it is already
  # tomorrow in Auckland, so UTC would call today's shift a future one and let a config change
  # delete and reassign a turn the members were texted about this morning. At 02:00 UTC it is
  # still yesterday in Honolulu, so UTC would call tomorrow's shift a past one and refuse to
  # regenerate a turn that is genuinely still a day away, and whose day-of reminder has not gone
  # out. Neither is a rounding error: both rewrite or freeze a real person's chore.
  #
  # So the boundary is the group's midnight, not the server's, and this is the one place that says
  # so.
  def today
    Time.current.in_time_zone(time_zone).to_date
  end

  # A group JIT-created from a WorkOS token has no timezone in the token to take, so it is created
  # as UTC — a guess. That guess drives `send_hour` for every reminder, so a London house created as
  # UTC would text everyone an hour early once BST begins, silently and forever. `timezone_confirmed_at`
  # is NULL until a human sets the timezone (BLO-1047's settings API stamps it); while it is NULL,
  # the timezone is provisional and the dashboard warns (BLO-1053). Never stamped on JIT insert.
  def timezone_confirmed?
    timezone_confirmed_at.present?
  end

  # Paused by an operator (BLO-1675). Suspension is not a soft delete: nothing is removed and
  # nothing is rewritten. What it means, exactly, is written down in one place — the plan's
  # "Suspension, precisely" — and enforced in five: Authenticatable (403 to the house's admins,
  # with /api/me exempt so the paused screen can still name the house), ReminderSweepJob and
  # TopUpShiftWindowsJob (the loops skip it), the member path and the household entry page (both
  # answer `paused: true`).
  def suspended?
    suspended_at.present?
  end

  # Both idempotent, and both answer whether they actually changed anything, so a second POST is a
  # no-op rather than a moved timestamp: re-suspending must not rewrite "paused since", which is the
  # first thing anyone asks about a paused house.
  def suspend!(at: Time.current)
    change_suspension(at, verb: "suspended", already: "already paused")
  end

  def resume!
    change_suspension(nil, verb: "resumed", already: "already live")
  end

  private

  # The audit trail for an operator action is a Rails log line naming their WorkOS `sub`, and that is
  # deliberate: there is no row for a super admin — the allowlist is an environment variable — so
  # there is nothing for a foreign key to point at, and inventing a table to hold one identifier
  # would be a schema that exists to look like an audit rather than to be one.
  #
  # The no-op is logged too. "Suspend this house" was asked for either way, and an operator who
  # clicked twice should find both requests in the log rather than one of them silently missing.
  def change_suspension(at, verb:, already:)
    changed = suspended? != at.present?
    update!(suspended_at: at) if changed

    operator = Current.super_admin_workos_user_id || "an unidentified caller"
    outcome = changed ? verb : "re-#{verb} a house that was #{already}"
    Rails.logger.info("Super admin #{operator} #{outcome}: group #{id} (#{slug})")

    changed
  end

  def assign_slug
    # Names are not globally unique. A short suffix keeps links stable and avoids
    # making household creation contend for a name. Renaming never breaks a link.
    base = name.to_s.parameterize.gsub(/[^a-z0-9]+/, "-").first(60).gsub(/\A-+|-+\z/, "").presence || "household"
    self.slug ||= "#{base}-#{SecureRandom.hex(4)}"
  end

  def timezone_must_be_recognised
    return if timezone.blank?
    return if ActiveSupport::TimeZone[timezone]

    errors.add(:timezone, "is not a recognised time zone")
  end
end
