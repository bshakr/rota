module Api
  # The roster, set in one call: PUT /api/rotas/:rota_id/positions with an ordered array of member
  # ids. The order IS the rotation, so the whole roster is replaced atomically rather than nudged
  # a row at a time — there is no valid intermediate state where the running order is half-applied.
  #
  # Replacing the roster is a ROSTER change, so regeneration PRESERVES covers: rebuild the future
  # from the new order, but leave every shift someone already agreed to cover exactly as it stands.
  # Adding Dave does not cancel Alice's arrangement with Bob.
  class RotaPositionsController < BaseController
    def update
      rota = group_scope(:rotas).find(params[:rota_id])

      RotaPosition.transaction do
        rota.rota_positions.destroy_all
        # create! not insert_all: RotaPosition validates that every member belongs to the rota's
        # group, so a stray or cross-tenant id is a rolled-back 422, never a stranger on the roster.
        member_ids.each_with_index do |member_id, position|
          rota.rota_positions.create!(member_id: member_id, position: position)
        end
      end

      regeneration = RotaRegenerator.new(rota).roster_changed
      render json: {
        rota: RotaSerializer.one(rota.reload),
        regeneration: { deleted: regeneration.deleted, inserted: regeneration.inserted,
                        dropped_covers: regeneration.dropped_covers }
      }
    end

    private

    # An explicit empty array is allowed: it empties the roster and returns the rota to draft. A
    # missing key is a malformed request, not a request to clear.
    def member_ids
      raise ActionController::ParameterMissing, :member_ids unless params.key?(:member_ids)

      params.permit(member_ids: [])[:member_ids] || []
    end
  end
end
