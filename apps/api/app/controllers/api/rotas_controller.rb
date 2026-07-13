module Api
  # Rotas: a named job, its schedule, its message, and (through positions) its roster. The one piece
  # of real judgement here is the schedule change — moving `starts_on` or the interval moves the
  # dates themselves, so every future shift is regenerated and its covers are dropped. That is
  # destructive in a way renaming a rota is not, so it is gated behind an explicit confirmation and
  # a warning that says what it will cost.
  class RotasController < BaseController
    # The three fields whose change re-cuts the series. A change to any of them is a schedule change;
    # a change to name, template, send hour, offsets or active is not, and applies without ceremony.
    SCHEDULE_ATTRIBUTES = %w[starts_on interval_count interval_unit].freeze

    def index
      rotas = group_scope(:rotas).includes(rota_positions: :member).order(:name)
      render json: { rotas: RotaSerializer.many(rotas) }
    end

    def show
      render json: { rota: RotaSerializer.one(find_rota) }
    end

    def create
      rota = group_scope(:rotas).create!(rota_params)
      # A rota with no roster is a draft, so this is a no-op today; running it anyway means a rota
      # created with a roster in one call still gets its window, by the same path an edit would use.
      ShiftGenerator.new(rota).call
      render json: { rota: RotaSerializer.one(rota) }, status: :created
    end

    # A schedule change without `confirm: true` answers with the warning and changes NOTHING — not
    # the rota, not a single shift. The admin sees what confirming would drop, and only a second
    # request carrying the confirmation goes through with it.
    def update
      rota = find_rota
      rota.assign_attributes(rota_params)
      schedule_change = (rota.changed & SCHEDULE_ATTRIBUTES).any?

      if schedule_change && !confirmed?
        # Computed against the shifts as they stand now, before the write — afterwards the dates have
        # moved and the covers it names are attached to a series that no longer exists.
        warning = RotaRegenerator.new(rota).schedule_change_warning
        rota.restore_attributes # leave absolutely nothing changed in memory either
        return render_problem(
          "confirmation_required",
          :unprocessable_content,
          message: "This schedule change regenerates future shifts and drops any covers on them.",
          warning: warning
        )
      end

      rota.save!
      # Only a confirmed schedule change regenerates. A plain edit (name, template, offsets) leaves
      # the shifts alone — none of it changes a date or an assignment.
      regeneration = RotaRegenerator.new(rota).schedule_changed if schedule_change

      render json: { rota: RotaSerializer.one(rota) }.merge(regeneration_payload(regeneration))
    end

    # Retire, don't erase. Destroying a rota would cascade its shifts, and those shifts are the record
    # of who actually did the job — immutable history the product exists to keep. Deactivating stops
    # the reminder sweep (it only visits active rotas) and hides the rota, while the history stands.
    def destroy
      rota = find_rota
      rota.update!(active: false)
      render json: { rota: RotaSerializer.one(rota) }
    end

    # The live preview for the rota editor. Renders through the exact code path a real reminder uses
    # (Sms::Renderer), against a real member, so a preview can never flatter a template that would
    # fail to send. Accepts an in-progress `message_template` so the editor previews what is being
    # typed, not only what was last saved — validated the same way a save would validate it.
    def preview_message
      rota = find_rota
      member = preview_member(rota)
      return render_problem("no_member_to_preview", :unprocessable_content,
        message: "Add a member to the group before previewing a message.") if member.nil?

      candidate = candidate_rota(rota)
      template_errors = candidate.errors[:message_template]
      return render_problem("validation_failed", :unprocessable_content,
        message: template_errors.to_sentence, fields: { message_template: template_errors }) if template_errors.any?

      due_on = preview_due_on(rota)
      render json: {
        preview: Sms::Renderer.render(rota: candidate, member: member, due_on: due_on),
        member: MemberSerializer.one(member),
        due_on: due_on
      }
    end

    private

    def find_rota
      group_scope(:rotas).includes(rota_positions: :member).find(params[:id])
    end

    def rota_params
      params.permit(:name, :message_template, :starts_on, :interval_count, :interval_unit,
        :send_hour, :active, reminder_offsets: [])
    end

    def confirmed?
      ActiveModel::Type::Boolean.new.cast(params[:confirm])
    end

    def regeneration_payload(outcome)
      return {} if outcome.nil?

      { regeneration: { deleted: outcome.deleted, inserted: outcome.inserted,
                        dropped_covers: outcome.dropped_covers } }
    end

    # Who the preview is rendered as: a named member if asked for (scoped, so a cross-tenant id is a
    # 404), otherwise the first person on the roster, otherwise anyone active in the group. Nil only
    # when the group has no members at all — the one case the preview genuinely cannot render.
    def preview_member(rota)
      return group_scope(:members).find(params[:member_id]) if params[:member_id].present?

      rota.members.first || group_scope(:members).active.first
    end

    # The rota to render. When the request carries a candidate template, render a detached copy that
    # holds it — validated first, so a typo becomes a clean 422 rather than a raised renderer error —
    # so the preview reflects the unsaved edit without touching the stored rota.
    def candidate_rota(rota)
      return rota unless params.key?(:message_template)

      copy = Rota.new(rota.attributes.merge("message_template" => params[:message_template]))
      copy.validate
      copy
    end

    # A representative date, so `{{date}}` and `{{days_until}}` read like a real reminder: the next
    # upcoming shift if there is one, otherwise the rota's own start date.
    def preview_due_on(rota)
      rota.shifts.upcoming(current_group.today).minimum(:due_on) || rota.starts_on
    end
  end
end
