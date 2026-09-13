module SuperAdmin
  # The house's own dashboard warnings, as the data that produces them.
  #
  # The plan is explicit (Group dashboard): "Warnings, from `collectDashboardWarnings` with the same
  # inputs, so the operator sees exactly the alerts the house admin sees." That guarantee is only
  # worth anything if the inputs are the SAME inputs, so this class does not describe the shape from
  # memory — it composes the four payloads the house's own dashboard fetches, through the house's own
  # serializers:
  #
  #   apps/web/src/app/(admin)/dashboard/page.tsx calls getGroup(), listRotas(), listMembers() and
  #   listSmsMessages({ status: "failed", limit: 100 }), then hands the four results straight to
  #   collectDashboardWarnings (apps/web/src/lib/dashboard.ts).
  #
  # So: GET /api/group is ::GroupSerializer, GET /api/rotas is ::RotaSerializer,
  # GET /api/members is ::MemberSerializer, GET /api/sms_messages?status=failed is the log's own
  # scope and order. Change any of those and this moves with them, because it IS them. A second
  # hand-written copy of the shape is precisely how the operator would end up being shown a warning
  # the house admin never saw, or missing one they did — and a redundant warning is only a nuisance
  # while a missed one is the whole reason this screen exists.
  # spec/requests/super_admin/group_report_spec.rb asserts the equality against the live endpoints.
  #
  # TWO differences, both of them credentials, both mandated by the plan's "Member PII shown to
  # super admin" decision — phone numbers in full, magic-link tokens never:
  #
  #   1. `members` drops `access_token`. The house's MemberSerializer exposes it on purpose (it is
  #      the member's magic link and handing it out is a core admin action); it is a permanent login
  #      to somebody else's house and an operator never needs it.
  #   2. `failed_sms` is rendered by SuperAdmin::SmsMessageSerializer rather than the house's,
  #      because every text this product sends carries that same link inside its body.
  #
  # Neither is visible to `collectDashboardWarnings`, which reads only `group.timezone`,
  # `group.timezone_confirmed`, `group.calendar`, each rota's `name` and `draft`, each member's
  # `name`, `active` and `contactable`, and each failed text's `member.id` and `member.name`.
  # spec/requests/super_admin/redaction_spec.rb greps the whole response for both credentials.
  class WarningsInput
    # What the house's own dashboard asks for (`listSmsMessages({ status: "failed", limit: 100 })`).
    # Hard-coded rather than reached for out of SmsMessageFiltering: that is a controller concern
    # describing what a caller MAY ask for, and this is the one number the dashboard page actually
    # asks for. The two agreeing today is not a reason to couple a query object to a controller.
    FAILED_SMS_LIMIT = 100

    FAILED = SmsMessage::STATUSES.fetch(:failed)

    def self.call(group) = new(group).call

    def initialize(group)
      @group = group
    end

    def call
      {
        # `::` on every house serializer, deliberately and everywhere. Inside `module SuperAdmin`
        # a bare `GroupSerializer` resolves to SuperAdmin::GroupSerializer — the operator's shape,
        # which is not the shape the house's dashboard is handed and would silently defeat the
        # whole point of this class.
        group: ::GroupSerializer.one(group),
        rotas: ::RotaSerializer.many(rotas),
        members: ::MemberSerializer.many(members).map { |row| row.except(:access_token) },
        failed_sms: SuperAdmin::SmsMessageSerializer.many(failed_sms)
      }
    end

    private

    attr_reader :group

    # Api::RotasController#index, including its preload and its order.
    def rotas
      group.rotas.includes(rota_positions: :member).order(:name)
    end

    # Api::MembersController#index. Every member, not just the active ones: the "won't get texts"
    # warning is about people who are active and not contactable, which needs both flags.
    def members
      group.members.order(:name)
    end

    # Api::SmsMessagesController#index with `status=failed&limit=100`, including its preload and its
    # newest-first order, so the operator counts the same failures off the same rows.
    def failed_sms
      group.sms_messages
        .includes(:member, shift: :rota)
        .where(status: FAILED)
        .order(created_at: :desc, id: :desc)
        .limit(FAILED_SMS_LIMIT)
    end
  end
end
