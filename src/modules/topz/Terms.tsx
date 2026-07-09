export function TopzTerms() {
  const sections = [
    {
      title: 'Booking Confirmation',
      points: [
        'Booking will be confirmed only after receiving the required advance payment.',
        'Vehicle availability is subject to confirmation at the time of booking.',
        'Customers must provide complete trip details, including pickup location, date, time, destination, and passenger count.',
      ],
    },
    {
      title: 'Payment Policy',
      points: [
        'An advance payment is required to confirm every booking.',
        'The remaining balance must be paid before or at the start of the journey unless otherwise agreed.',
        'Payments can be made via UPI, Bank Transfer, Cash, or other approved payment methods.',
      ],
    },
    {
      title: 'Toll, Parking & Taxes',
      points: [
        'Toll charges, parking fees, state taxes, and entry fees are extra unless specifically mentioned as "Included" in the quotation.',
        'Airport parking, event parking, and any additional government taxes will be borne by the customer.',
      ],
    },
    {
      title: 'Extra Kilometer & Extra Hour Charges',
      points: [
        'Extra kilometer and extra hour charges will be applicable as per the vehicle package mentioned in the quotation.',
        'Duty starts and ends as per the agreed reporting time.',
        'Garage to Garage calculation will be applicable (Malad to Malad), unless otherwise mentioned in the quotation.',
      ],
    },
    {
      title: 'Night Driver Allowance',
      points: [
        'Driver allowance may apply for late-night travel or multi-day trips as mentioned in the quotation.',
        'Night Driver Allowance (DA) will be applicable as per company policy.',
      ],
    },
    {
      title: 'Waiting Charges',
      points: [
        'Waiting charges may apply if the vehicle is kept waiting beyond the complimentary waiting period.',
      ],
    },
    {
      title: 'Cancellation Policy',
      points: [
        'Cancellation charges will apply as per the booking terms.',
        'Advance payment may be non-refundable during peak seasons, festivals, weekends, or special event bookings.',
        'Any eligible refund will be processed within the company\'s standard processing period.',
      ],
    },
    {
      title: 'Customer Responsibilities',
      points: [
        'Customers are responsible for maintaining cleanliness inside the vehicle.',
        'Smoking, alcohol consumption, illegal activities, and carrying prohibited items inside the vehicle are strictly prohibited.',
        'Any damage caused to the vehicle by passengers will be charged to the customer.',
      ],
    },
    {
      title: 'Driver & Vehicle',
      points: [
        'All vehicles are regularly serviced and sanitized.',
        'Drivers are experienced, licensed, and verified.',
        'Customers are requested to treat drivers respectfully throughout the journey.',
      ],
    },
    {
      title: 'Delays & Force Majeure',
      points: [
        'TopzCab is not responsible for delays caused by traffic, road closures, weather conditions, vehicle restrictions, strikes, natural disasters, or any other circumstances beyond our control.',
      ],
    },
    {
      title: 'Passenger Belongings',
      points: [
        'Customers are requested to check their belongings before leaving the vehicle.',
        'TopzCab shall not be responsible for any loss, theft, or damage to personal belongings left inside the vehicle.',
      ],
    },
    {
      title: 'Route & Itinerary Changes',
      points: [
        'Any change in route, destination, pickup point, or itinerary after the trip has started may result in additional charges.',
      ],
    },
    {
      title: 'Safety',
      points: [
        'Seat belts must be worn wherever available.',
        'Passengers are requested to follow all safety instructions provided by the driver.',
        'Passenger safety is our highest priority, and drivers will strictly follow all traffic rules and regulations.',
      ],
    },
    {
      title: 'Liability',
      points: [
        'TopzCab\'s liability is limited to providing the booked transportation service.',
        'We shall not be liable for missed flights, trains, meetings, events, or any consequential losses due to unavoidable delays.',
      ],
    },
    {
      title: 'Acceptance',
      points: [
        'By confirming a booking with TopzCab, the customer acknowledges that they have read, understood, and agreed to these Terms & Conditions.',
      ],
    },
  ]

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="glass-card rounded-2xl px-6 py-5"
        style={{ background: 'linear-gradient(135deg, rgba(240,192,64,0.08), rgba(240,192,64,0.03))', border: '1px solid rgba(240,192,64,0.2)' }}>
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#f0c040' }}>Terms &amp; Conditions</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          TopzCab — Please read these terms carefully before confirming your booking.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {sections.map((s, i) => (
          <div key={i} className="glass-card rounded-2xl px-5 py-4">
            <div className="flex items-start gap-3 mb-3">
              <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                style={{ background: 'rgba(240,192,64,0.15)', color: '#f0c040', border: '1px solid rgba(240,192,64,0.3)' }}>
                {i + 1}
              </span>
              <h2 className="font-bold text-sm pt-1" style={{ color: 'var(--text-base)' }}>{s.title}</h2>
            </div>
            <ul className="space-y-2 pl-10">
              {s.points.map((p, j) => (
                <li key={j} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(240,192,64,0.5)' }} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-xs text-center pb-4" style={{ color: 'var(--text-muted)' }}>
        Last updated · TopzCab Travel Management
      </p>
    </div>
  )
}
