module SuperAdmin
  # One house's delivery log, read by the operator instead of by the house.
  #
  # The same rows, found the same way — the filters and the page size come from SmsMessageFiltering,
  # shared with Api::SmsMessagesController so the operator is never debugging against a different
  # set of rows than the admin who reported the problem. What differs is what a row says:
  # SuperAdmin::SmsMessageSerializer replaces the magic link inside every body, because that link
  # is a permanent login to this house and the operator has no question that needs it.
  class SmsMessagesController < BaseController
    include SmsMessageFiltering

    def index
      # Unscoped on purpose: see SuperAdmin::GroupsController#show for why, and
      # SuperAdminAuthenticatable for the allowlist check that has already run by the time this
      # line does. Rooting the log in the group found here is what keeps the filters below from
      # reaching any further than the one house asked for.
      group = Group.find(params[:group_id])

      messages = group.sms_messages
        .includes(:member, shift: :rota)
        .order(created_at: :desc, id: :desc)
      messages = apply_sms_filters(messages).limit(sms_limit)

      render json: { sms_messages: SmsMessageSerializer.many(messages) }
    end
  end
end
