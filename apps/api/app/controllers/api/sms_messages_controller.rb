module Api
  # The delivery log — the unglamorous screen that answers "why didn't Alice get her text". Scoped
  # through the group's members, newest first, filterable, and bounded: an admin scanning for a
  # failure wants the most recent page, not the whole history of the house at once.
  class SmsMessagesController < BaseController
    DEFAULT_LIMIT = 100
    MAX_LIMIT = 500

    def index
      messages = group_scope(:sms_messages)
        .includes(:member, shift: :rota)
        .order(created_at: :desc, id: :desc)
      messages = apply_filters(messages).limit(limit)

      render json: { sms_messages: SmsMessageSerializer.many(messages) }
    end

    private

    # Filters are the log's whole point — "show me the failures", "show me Alice's texts". Each is
    # scoped through the group already, so `rota_id`/`member_id` can only ever narrow within the
    # caller's own house.
    def apply_filters(scope)
      scope = scope.where(status: params[:status]) if params[:status].present?
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      scope = scope.where(member_id: params[:member_id]) if params[:member_id].present?
      scope = scope.where(shifts: { rota_id: params[:rota_id] }).references(:shifts) if params[:rota_id].present?
      scope
    end

    # A caller can ask for fewer, but not for more than MAX_LIMIT — an unbounded log query is a way
    # to pull the whole table in one request.
    def limit
      requested = params[:limit].to_i
      return DEFAULT_LIMIT if requested <= 0

      [ requested, MAX_LIMIT ].min
    end
  end
end
