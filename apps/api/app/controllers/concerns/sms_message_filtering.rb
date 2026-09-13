# How a delivery log is narrowed and how much of it comes back, shared by the two controllers that
# serve one: the house's own log (Api::SmsMessagesController) and the operator's redacted view of
# the same rows (SuperAdmin::SmsMessagesController).
#
# Only the filtering is shared, and deliberately only the filtering. What a row *says* is decided
# by two different serializers, because redaction has to be structural and a shared renderer with
# a flag is exactly the thing that leaks. What a row is *found* by is the same question on both
# screens — "show me the failures", "show me Alice's texts" — and letting one of them quietly gain
# a filter the other does not have is how an operator ends up debugging a house against a
# different set of rows than the house itself can see.
#
# Neither caller's scope is widened by anything here: the house's is already rooted in its own
# group through `group_scope`, the operator's in the one group it looked up, so `member_id` and
# `rota_id` can only ever narrow within the set the caller already had.
module SmsMessageFiltering
  extend ActiveSupport::Concern

  DEFAULT_LIMIT = 100
  MAX_LIMIT = 500

  private

  def apply_sms_filters(scope)
    scope = scope.where(status: params[:status]) if params[:status].present?
    scope = scope.where(kind: params[:kind]) if params[:kind].present?
    scope = scope.where(member_id: params[:member_id]) if params[:member_id].present?
    scope = scope.where(shifts: { rota_id: params[:rota_id] }).references(:shifts) if params[:rota_id].present?
    scope
  end

  # A caller can ask for fewer, but not for more than MAX_LIMIT — an unbounded log query is a way
  # to pull the whole table in one request.
  def sms_limit
    requested = params[:limit].to_i
    return DEFAULT_LIMIT if requested <= 0

    [ requested, MAX_LIMIT ].min
  end
end
