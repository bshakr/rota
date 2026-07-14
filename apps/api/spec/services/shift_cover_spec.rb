require "rails_helper"

# ShiftCover is the one locked path every writer of a shift's cover goes through. These specs prove
# the property that matters: a change re-evaluates its guard against the committed state under the
# rota lock, so two writers racing the same shift — two members, a member and an admin override, or a
# member and a rota regeneration — cannot both win, and a cover cannot land on a shift that has been
# regenerated away. A member-style guard ("only the currently-responsible member may hand on") stands
# in for the caller's rules; an admin-style guard is a no-op check (the override has no
# responsible-member rule).
RSpec.describe ShiftCover do
  RESPONSIBLE_ONLY = ->(actor) { ->(shift) { shift.responsible_member.id == actor.id ? nil : :not_responsible } }

  describe ".change" do
    let(:group) { create(:group) }
    let(:rota) { create(:rota, group: group) }
    let(:alice) { create(:member, group: group, name: "Alice") }
    let(:bob) { create(:member, group: group, name: "Bob") }
    let(:cara) { create(:member, group: group, name: "Cara") }
    let(:shift) { create(:shift, rota: rota, assigned_member: alice, due_on: 5.days.from_now.to_date) }

    it "sets the cover and reports who was responsible before and after" do
      result = ShiftCover.change(shift: shift, to: bob) { nil }

      expect(result).to be_ok
      expect(shift.reload.covering_member).to eq(bob)
      expect(result.previous_responsible).to eq(alice)
      expect(result.new_responsible).to eq(bob)
    end

    it "returns the guard's error and writes nothing when the guard fails" do
      result = ShiftCover.change(shift: shift, to: bob) { :nope }

      expect(result).not_to be_ok
      expect(result.error).to eq(:nope)
      expect(shift.reload.covering_member).to be_nil
    end

    # The controller turns this into a 404: a shift a regeneration deleted between the request's
    # lookup and the lock is gone by the time `lock!` re-reads it FOR UPDATE.
    it "raises RecordNotFound when the shift was deleted before the lock" do
      stale = Shift.find(shift.id)
      shift.destroy!

      expect { ShiftCover.change(shift: stale, to: bob) { nil } }
        .to raise_error(ActiveRecord::RecordNotFound)
    end

    # The lost-update the lock exists to prevent, made deterministic: two requests read the shift
    # before either writes, then commit in sequence. The second's guard runs against the FIRST's
    # committed state (lock! reloaded the row), so it is refused rather than overwriting the winner.
    it "re-evaluates the guard against the committed state, not the stale read" do
      first_request = Shift.find(shift.id)
      second_request = Shift.find(shift.id) # both loaded while the shift is uncovered

      ShiftCover.change(shift: first_request, to: bob) { nil } # alice -> bob commits

      result = ShiftCover.change(shift: second_request, to: cara, &RESPONSIBLE_ONLY.call(alice))

      expect(result.error).to eq(:not_responsible)
      expect(shift.reload.covering_member).to eq(bob)
    end

    # Cross-writer: an admin override (a no-op guard — the admin needs no responsible-member rule)
    # commits a cover; a member's raced hand-on, which read the shift as its own, re-reads under the
    # lock, finds the admin's cover, and is refused rather than lost-updating over it.
    it "does not let a member cover overwrite an admin override it raced" do
      member_request = Shift.find(shift.id)

      ShiftCover.change(shift: Shift.find(shift.id), to: cara) { nil } # admin override -> cara

      result = ShiftCover.change(shift: member_request, to: bob, &RESPONSIBLE_ONLY.call(alice))

      expect(result.error).to eq(:not_responsible)
      expect(shift.reload.covering_member).to eq(cara)
    end
  end

  # The real thing: OS threads, separate database connections, one shift. Runs without transactional
  # fixtures (mirroring spec/models/group_admin_spec.rb) so the rota lock is a real FOR UPDATE across
  # connections, not a savepoint on one.
  describe "under real concurrency", :no_fixture_transaction do
    self.use_transactional_tests = false

    after do
      next unless @group

      rota_ids = Rota.where(group_id: @group.id).pluck(:id)
      shift_ids = Shift.where(rota_id: rota_ids).pluck(:id)
      SmsMessage.where(shift_id: shift_ids).delete_all
      Shift.where(id: shift_ids).delete_all
      RotaPosition.where(rota_id: rota_ids).delete_all
      Rota.where(id: rota_ids).delete_all
      Member.where(group_id: @group.id).delete_all
      Group.where(id: @group.id).delete_all
    end

    def seed!
      @group = create(:group)
      rota = create(:rota, group: @group)
      alice = create(:member, group: @group, name: "Alice")
      bob = create(:member, group: @group, name: "Bob")
      cara = create(:member, group: @group, name: "Cara")
      shift = create(:shift, rota: rota, assigned_member: alice, due_on: 5.days.from_now.to_date)
      [ rota, alice, bob, cara, shift ]
    end

    it "lets exactly one of two racing hand-overs win" do
      _rota, alice, bob, cara, shift = seed!

      results = [ bob.id, cara.id ].map do |cover_id|
        Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            ShiftCover.change(shift: Shift.find(shift.id), to: Member.find(cover_id),
              &RESPONSIBLE_ONLY.call(alice))
          end
        end
      end.map(&:value)

      expect(results.count(&:ok?)).to eq(1)
      expect(shift.reload.covering_member_id).to be_in([ bob.id, cara.id ])
    end

    # A cover racing a rota regeneration. Regeneration holds the rota lock while it captures its
    # doomed set and deletes those shifts BY ID (as RotaRegenerator's `rota.with_lock { doomed.
    # destroy_all }` does), so a cover landing in that window would be dropped and, in the member
    # controller, its notice fired for a deleted shift. Because ShiftCover takes the SAME rota lock,
    # the cover blocks until regeneration commits, then re-reads the shift, finds it gone, and raises.
    it "cannot land on a shift a concurrent regeneration deletes" do
      _rota, alice, bob, _cara, shift = seed!
      rota_id = shift.rota_id
      shift_id = shift.id

      holding_lock = Queue.new
      may_delete = Queue.new

      regeneration = Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          Rota.find(rota_id).with_lock do
            doomed = Shift.where(id: shift_id).to_a # captured while uncovered, deleted by id below
            holding_lock << true
            may_delete.pop
            doomed.each(&:destroy)
          end
        end
      end

      holding_lock.pop # regeneration now holds the rota lock with its doomed set captured

      outcome = nil
      cover = Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          ShiftCover.change(shift: Shift.find(shift_id), to: Member.find(bob.id),
            &RESPONSIBLE_ONLY.call(alice))
          outcome = :committed
        rescue ActiveRecord::RecordNotFound
          outcome = :not_found
        end
      end

      sleep 0.2 # let the cover reach and block on the rota lock, so it is decided under contention
      may_delete << true
      [ regeneration, cover ].each(&:join)

      expect(outcome).to eq(:not_found)
      expect(Shift.where(id: shift_id)).to be_empty
      expect(SmsMessage.cover_notice.where(shift_id: shift_id)).to be_empty
    end
  end
end
