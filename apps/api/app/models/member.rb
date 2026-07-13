# A person who takes turns. Members belong to the group, not to a rota: Alice is entered once and
# can appear in the kitchen rota, the bins rota and the bathroom rota. `rota_positions` gives each
# rota its own ordered subset.
class Member < ApplicationRecord
  ACCESS_TOKEN_BYTES = 32

  belongs_to :group

  has_many :rota_positions, dependent: :destroy
  has_many :rotas, through: :rota_positions

  # A member who appears anywhere in shift history cannot be destroyed — that history is a record
  # of who was actually responsible, and nulling or deleting it would rewrite the past. Removing
  # someone from the house means deactivating them (`active: false`), which is exactly what the
  # `active` flag is for.
  has_many :assigned_shifts, class_name: "Shift", foreign_key: :assigned_member_id,
    inverse_of: :assigned_member, dependent: :restrict_with_error
  has_many :covering_shifts, class_name: "Shift", foreign_key: :covering_member_id,
    inverse_of: :covering_member, dependent: :restrict_with_error

  has_many :sms_messages, dependent: :destroy

  scope :active, -> { where(active: true) }
  # Everyone the system is still allowed to text. The reminder sweep and the cover flow both
  # narrow to this, so "inactive" and "opted out" are handled in one place rather than two.
  scope :contactable, -> { active.where(sms_opted_out_at: nil) }

  before_validation :normalise_phone
  before_validation :assign_access_token, on: :create

  validates :name, presence: true
  validates :phone_e164, presence: true
  validate :phone_must_be_dialable
  validates :access_token, presence: true, uniqueness: true

  def contactable?
    active? && sms_opted_out_at.nil?
  end

  # For when a phone is lost: the old magic link stops working immediately.
  def rotate_access_token!
    update!(access_token: self.class.generate_access_token)
  end

  def self.generate_access_token
    SecureRandom.urlsafe_base64(ACCESS_TOKEN_BYTES)
  end

  private

  # Numbers arrive however the admin typed them — "07123 456789", "+44 7123 456789", "(07123)
  # 456789" — and are stored in exactly one form. Note this only *converts*; whether the result is
  # a real, dialable number is `phone_must_be_dialable`'s job.
  def normalise_phone
    return if phone_e164.blank?

    e164 = Phonelib.parse(phone_e164, Phonelib.default_country).e164
    # Junk parses to nothing. Leave it in place so the validation error names what was typed.
    self.phone_e164 = e164 if e164.present?
  end

  # Validate the E.164 form rather than what was typed, because the E.164 form is what gets
  # stored, texted and dialled. It is also the only form libphonenumber judges consistently:
  # asked about "07911123456" in national form it says invalid, and about the very same number as
  # "+447911123456" it says valid. Normalise first, then judge; the two steps are not
  # interchangeable.
  def phone_must_be_dialable
    return if phone_e164.blank?
    return if Phonelib.parse(phone_e164).valid?

    errors.add(:phone_e164, "is not a valid phone number")
  end

  def assign_access_token
    self.access_token ||= self.class.generate_access_token
  end
end
