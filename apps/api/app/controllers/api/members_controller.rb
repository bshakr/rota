module Api
  # The people who take turns. Everything here is scoped through `group_scope(:members)`, so a member
  # id from another house resolves to 404 rather than anyone else's phone number.
  class MembersController < BaseController
    def index
      members = group_scope(:members).order(:name)
      render json: { members: MemberSerializer.many(members) }
    end

    def create
      member = group_scope(:members).create!(member_params)
      render json: { member: MemberSerializer.one(member) }, status: :created
    end

    def update
      member = group_scope(:members).find(params[:id])
      member.update!(member_params)
      render json: { member: MemberSerializer.one(member) }
    end

    # Deactivate, never destroy — and say precisely what that costs. The response names every future
    # turn that will be redistributed and every cover the member had agreed to that will be undone,
    # so "remove Alice" is never a silent reshuffle of who does what next week. See MemberRemoval.
    def destroy
      member = group_scope(:members).find(params[:id])
      result = MemberRemoval.new(member).call

      render json: {
        member: MemberSerializer.one(member.reload),
        reassigned_shifts: result.reassigned,
        dropped_covers: result.dropped_covers
      }
    end

    # For when a phone is lost. Rotating the token immediately voids the old magic link, so a handset
    # in the wrong hands stops being a working credential the moment the admin presses the button.
    def rotate_link
      member = group_scope(:members).find(params[:id])
      member.rotate_access_token!
      render json: { member: MemberSerializer.one(member) }
    end

    private

    # Deliberately no `active`. Deactivation is DELETE and only DELETE, because that path also removes
    # the member from every roster, drops the covers they'd agreed to, and regenerates — flipping the
    # flag here would leave an inactive member still on rosters, still being assigned future shifts,
    # and silently skipped by the reminder sweep. Phone normalisation and validation are the model's
    # job (Member), so a bad number surfaces as a structured 422 rather than being stored as typed.
    def member_params
      params.permit(:name, :phone_e164)
    end
  end
end
