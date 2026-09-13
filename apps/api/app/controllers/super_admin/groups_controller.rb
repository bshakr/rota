module SuperAdmin
  # Every house in the database, and then one of them in full.
  #
  # This is the first endpoint in the operator area that actually reads across tenants, which is
  # the whole reason SuperAdmin::BaseController exists and is deliberately not TenantScoped. The
  # queries here are unscoped ON PURPOSE and are the only kind this namespace has.
  class GroupsController < BaseController
    # The tail of the house's delivery log, carried on the group page so the operator can see
    # whether texts are landing without a second request. The full log, with filters, is
    # SuperAdmin::SmsMessagesController.
    RECENT_SMS_LIMIT = 20

    # The only orders a caller may ask for. Each is a sort key, not a column: two of the four sort
    # on counts that live in SuperAdmin::GroupStats rather than on `groups`, so the ordering is
    # applied to the loaded page. Anything not on this list falls back to name, so a typo in a
    # query string sorts predictably rather than reaching the database as one.
    SORTS = {
      "name" => ->(_group, _stats) { 0 },
      "created" => ->(group, _stats) { -group.created_at.to_f },
      "last_activity" => ->(_group, stats) { stats.last_activity_at ? -stats.last_activity_at.to_f : Float::INFINITY },
      "texts" => ->(_group, stats) { -stats.texts }
    }.freeze

    DEFAULT_SORT = "name".freeze

    def index
      # Narrowed in SQL, counted in one grouped pass, then filtered and ordered by the rules that
      # are derived rather than stored. `to_a` before the counts on purpose: SuperAdmin::GroupStats
      # needs the same objects that are about to be serialized, and re-running the relation to get
      # them would be the N+1 this whole path is arranged to avoid.
      groups = narrow(Group.all).order(:name).to_a
      stats = GroupStats.new(groups, now: now)
      rows = sort(keep(groups, stats), stats)

      render json: { groups: GroupSerializer.many(rows, stats: stats, now: now) }
    end

    def show
      # Unscoped on purpose, and this is the one place per controller the plan asks to have it said
      # out loud. On the house side an id from the client is always resolved through
      # `group_scope`, so a cross-tenant id is a 404 and there is no id that reaches out of the
      # caller's own house. Here the caller IS the operator, already checked against the
      # SUPER_ADMIN_WORKOS_USER_IDS allowlist by SuperAdminAuthenticatable before this action runs,
      # and reading any house by its id is the feature. An unknown id is still a 404 — see
      # SuperAdmin::BaseController.
      group = Group.find(params[:id])
      stats = GroupStats.new([ group ], now: now)

      render json: {
        group: GroupSerializer.one(group, stats: stats, now: now),
        admins: AdminSerializer.many(group.group_admins.includes(:user).order(:id)),
        members: MemberSerializer.many(group.members.includes(:rotas).order(:name)),
        rotas: RotaSerializer.many(group.rotas.includes(:rota_positions).order(:name)),
        recent_sms_messages: SmsMessageSerializer.many(recent_sms_messages(group))
      }
    end

    # Rename, set the timezone, and the operator's private note about the house (BLO-1675).
    #
    # The timezone carries exactly the semantics the house's own PATCH gives it (Api::GroupController):
    # sending a `timezone` at all stamps `timezone_confirmed_at`, because the presence of the param is
    # a human saying "I checked" — and a super admin setting it counts as a human confirming it. That
    # is most of the point of the action: the commonest reason to reach for it is a house being texted
    # on a UTC guess nobody ever corrected. The audit of *who* confirmed it is the Rails log line
    # below, naming the operator's WorkOS `sub`; there is no row to point a foreign key at, because a
    # super admin is an environment variable.
    def update
      # Unscoped on purpose; see #show for why, and SuperAdminAuthenticatable for the allowlist check
      # that has already run by the time this line does.
      group = Group.find(params[:id])

      # Read before the write: an audit that only says which fields were touched cannot answer the
      # question anyone actually asks of it afterwards, which is what the timezone used to be.
      was = group.slice(:name, :timezone)

      group.assign_attributes(group_params)
      group.timezone_confirmed_at = Time.current if group_params.key?(:timezone)
      # Bang, so a name the model rejects renders ApiErrorRendering's `validation_failed` with the
      # offending fields rather than a silent 200 over an unsaved record.
      group.save!

      logger.info("Super admin #{Current.super_admin_workos_user_id} updated group #{group.id} " \
                  "(#{group.slug}): #{audit_summary(was, group)}")

      render json: { group: GroupSerializer.solo(group, now: now) }
    end

    private

    # What changed, in the words an operator would use to explain it later: the name and the timezone
    # as transitions, because "timezone" alone cannot answer "what was it before you touched it?".
    #
    # The note's CONTENT is never logged, only that it was written or cleared. It is free text about
    # a house and the people in it — "chasing them about the card that keeps declining" — and the
    # application log is neither the place for it nor covered by the same handling the column is.
    def audit_summary(was, group)
      changes = []
      changes << "name #{was['name'].inspect} -> #{group.name.inspect}" if group_params.key?(:name)
      if group_params.key?(:timezone)
        changes << "timezone #{was['timezone'].inspect} -> #{group.timezone.inspect} (confirmed)"
      end
      changes << (group.notes.nil? ? "notes cleared" : "notes replaced") if group_params.key?(:notes)
      changes.presence&.join("; ") || "nothing"
    end

    # `notes` is operator-only and appears in no house-facing serializer — the two are separate
    # classes precisely so that cannot drift. A cleared box is no note rather than an empty one, so
    # the column goes back to NULL and "has this house got a note" stays one question and not two.
    def group_params
      permitted = params.permit(:name, :timezone, :notes)
      permitted[:notes] = permitted[:notes].presence if permitted.key?(:notes)
      permitted
    end

    # The whole list is evaluated in one instant, so a house does not read as Live in its pill and
    # Quiet to the filter beside it because the clock moved between the two.
    def now
      @now ||= Time.current
    end

    # What the database can narrow: the search box, and the one filter that is a plain column.
    def narrow(scope)
      scope = search(scope) if params[:q].present?
      scope = scope.where(timezone_confirmed_at: nil) if flag?(params[:unconfirmed_timezone])
      scope
    end

    # Name or slug, either way round. An operator types a fragment of whichever one they happen to
    # remember — the name they were told on a support email, or the slug out of a URL.
    def search(scope)
      term = "%#{ActiveRecord::Base.sanitize_sql_like(params[:q].to_s.strip)}%"
      scope.where("groups.name ILIKE :term OR groups.slug ILIKE :term", term: term)
    end

    # The filters that are derived rather than stored: status is computed from the counts, and so
    # is "has failures". They are applied to the loaded page rather than compiled into SQL so that
    # the rule the filter uses is literally the same code as the rule the pill renders — a second
    # copy in SQL is how a list ends up disagreeing with itself. There are tens of houses, not
    # thousands (the plan's own sizing); when a page takes over 500ms this is where the rollup goes.
    def keep(groups, stats)
      groups = groups.select { |group| status_of(group, stats) == params[:status] } if params[:status].present?
      groups = groups.select { |group| stats.for(group).failed_texts.positive? } if flag?(params[:has_failures])
      groups
    end

    def status_of(group, stats)
      GroupStatus.of(group, stats.for(group), now: now)
    end

    def sort(groups, stats)
      key = SORTS.fetch(params[:sort], SORTS.fetch(DEFAULT_SORT))

      # Name then id after the chosen key, so a page of houses with the same count or no activity
      # at all comes back in the same order every time rather than in whatever order Postgres felt
      # like returning.
      groups.sort_by { |group| [ key.call(group, stats.for(group)), group.name.downcase, group.id ] }
    end

    def flag?(value)
      ActiveModel::Type::Boolean.new.cast(value).present?
    end

    def recent_sms_messages(group)
      group.sms_messages
        .includes(:member, shift: :rota)
        .order(created_at: :desc, id: :desc)
        .limit(RECENT_SMS_LIMIT)
    end
  end
end
