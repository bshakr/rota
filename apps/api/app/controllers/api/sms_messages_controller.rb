module Api
  # The delivery log — the unglamorous screen that answers "why didn't Alice get her text". Scoped
  # through the group's members, newest first, filterable, and bounded: an admin scanning for a
  # failure wants the most recent page, not the whole history of the house at once.
  #
  # The filters and the page size live in SmsMessageFiltering, shared with the operator's redacted
  # view of the same rows (SuperAdmin::SmsMessagesController) so the two screens can never drift
  # into finding different rows. The serializer is NOT shared, on purpose: this one renders the
  # body as it was sent, magic link and all, because it is the house's own link.
  class SmsMessagesController < BaseController
    include SmsMessageFiltering

    def index
      messages = group_scope(:sms_messages)
        .includes(:member, shift: :rota)
        .order(created_at: :desc, id: :desc)
      messages = apply_sms_filters(messages).limit(sms_limit)

      render json: { sms_messages: SmsMessageSerializer.many(messages) }
    end
  end
end
