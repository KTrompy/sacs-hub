#!/usr/bin/env python3
"""
AlumNet → SACS Alumni Hub Data Migration Script
================================================

Reads an Excel export from SilverSky AlumNet and imports all alumni records
into the SACS Alumni Hub database (Supabase).

Usage:
  1. Export the full alumni database from AlumNet as .xlsx
  2. Place it in this directory
  3. Set environment variables:
       SUPABASE_URL        — your Supabase project URL
       SUPABASE_SERVICE_KEY — service-role key (NOT the anon key)
  4. Run:  python3 migrate_alumnet.py alumnet_export.xlsx

What it does:
  - Reads every row from the Excel file
  - Maps AlumNet columns → profiles + profile_details tables
  - Creates a Supabase Auth user for each email (so they can log in)
  - Inserts the profile data into both tables
  - Generates a report of what was imported and any issues

NOTE: This uses the service-role key, which bypasses RLS. Run this
locally or in a secure environment — never expose this key in client code.
"""

import sys
import os
import json
import re
import csv
from datetime import datetime

try:
    import openpyxl
except ImportError:
    print("Installing openpyxl...")
    os.system(f"{sys.executable} -m pip install openpyxl --break-system-packages -q")
    import openpyxl

try:
    from supabase import create_client
except ImportError:
    print("Installing supabase-py...")
    os.system(f"{sys.executable} -m pip install supabase --break-system-packages -q")
    from supabase import create_client


# ─── Column Mapping ───────────────────────────────────────────────────
# Left side: expected AlumNet column names (case-insensitive, fuzzy matched)
# Right side: target table and column in SACS Alumni Hub
#
# AlumNet columns are mapped from what we've seen in their admin panel:
#   File Number, Title, Known As, Initials, First Name, Last Name,
#   Surname at School, Email, Date of Birth, ID Number, Nationality,
#   Home Phone, Work Phone, Fax, Cell/Mobile, Old Boy, Current Parent,
#   Past Parent, Current Staff, Past Staff, Address Line 1/2/3,
#   Class Of / Graduation Year, Industry, Occupation, LinkedIn,
#   Communication Preferences

COLUMN_MAP = {
    # ── profiles table ──
    'first name':       ('profiles', 'first_name'),
    'firstname':        ('profiles', 'first_name'),
    'first_name':       ('profiles', 'first_name'),
    'last name':        ('profiles', 'last_name'),
    'lastname':         ('profiles', 'last_name'),
    'last_name':        ('profiles', 'last_name'),
    'surname':          ('profiles', 'last_name'),
    'email':            ('profiles', 'email'),
    'e-mail':           ('profiles', 'email'),
    'email address':    ('profiles', 'email'),
    'cell':             ('profiles', 'phone'),
    'cell phone':       ('profiles', 'phone'),
    'cellphone':        ('profiles', 'phone'),
    'mobile':           ('profiles', 'phone'),
    'mobile phone':     ('profiles', 'phone'),
    'class of':         ('profiles', 'grad_year'),
    'class':            ('profiles', 'grad_year'),
    'graduation year':  ('profiles', 'grad_year'),
    'grad year':        ('profiles', 'grad_year'),
    'matric year':      ('profiles', 'grad_year'),
    'year':             ('profiles', 'grad_year'),
    'industry':         ('profiles', 'industry'),
    'occupation':       ('profiles', 'occupation'),
    'job title':        ('profiles', 'occupation'),
    'company':          ('profiles', 'company'),
    'employer':         ('profiles', 'company'),
    'organisation':     ('profiles', 'company'),
    'organization':     ('profiles', 'company'),
    'city':             ('profiles', 'city'),
    'town':             ('profiles', 'city'),
    'country':          ('profiles', 'country'),
    'province':         ('profiles', 'province'),
    'state':            ('profiles', 'province'),
    'linkedin':         ('profiles', 'linkedin_url'),
    'linkedin url':     ('profiles', 'linkedin_url'),
    'address line 1':   ('profiles', 'address_line1'),
    'address line 2':   ('profiles', 'address_line2'),
    'address line 3':   ('profiles', 'address_line3'),
    'address1':         ('profiles', 'address_line1'),
    'address2':         ('profiles', 'address_line2'),
    'address3':         ('profiles', 'address_line3'),
    'address_line1':    ('profiles', 'address_line1'),
    'address_line2':    ('profiles', 'address_line2'),
    'address_line3':    ('profiles', 'address_line3'),
    'postal code':      ('profiles', 'postal_code'),
    'zip code':         ('profiles', 'postal_code'),
    'zip':              ('profiles', 'postal_code'),
    'degree':           ('profiles', 'degree'),
    'qualification':    ('profiles', 'degree'),

    # ── profile_details table ──
    'title':            ('details', 'title'),
    'known as':         ('details', 'known_as'),
    'known_as':         ('details', 'known_as'),
    'nickname':         ('details', 'known_as'),
    'preferred name':   ('details', 'known_as'),
    'initials':         ('details', 'initials'),
    'surname at school':('details', 'surname_at_school'),
    'maiden name':      ('details', 'surname_at_school'),
    'id number':        ('details', 'id_number'),
    'id_number':        ('details', 'id_number'),
    'identity number':  ('details', 'id_number'),
    'nationality':      ('details', 'nationality'),
    'date of birth':    ('details', 'date_of_birth'),
    'dob':              ('details', 'date_of_birth'),
    'birth date':       ('details', 'date_of_birth'),
    'date_of_birth':    ('details', 'date_of_birth'),
    'home phone':       ('details', 'phone_home'),
    'home tel':         ('details', 'phone_home'),
    'phone (home)':     ('details', 'phone_home'),
    'phone_home':       ('details', 'phone_home'),
    'work phone':       ('details', 'phone_work'),
    'work tel':         ('details', 'phone_work'),
    'phone (work)':     ('details', 'phone_work'),
    'phone_work':       ('details', 'phone_work'),
    'fax':              ('details', 'phone_fax'),
    'fax number':       ('details', 'phone_fax'),
    'phone_fax':        ('details', 'phone_fax'),
    'old boy':          ('details', 'old_boy'),
    'old_boy':          ('details', 'old_boy'),
    'current parent':   ('details', 'current_parent'),
    'past parent':      ('details', 'past_parent'),
    'current staff':    ('details', 'current_staff'),
    'past staff':       ('details', 'past_staff'),
    'gender':           ('details', 'gender'),
    'sex':              ('details', 'gender'),

    # ── metadata (not imported, just tracked) ──
    'file number':      ('meta', 'file_number'),
    'file no':          ('meta', 'file_number'),
    'member number':    ('meta', 'file_number'),
    'record number':    ('meta', 'file_number'),
}


def normalize_header(h):
    """Lowercase, strip, collapse whitespace."""
    return re.sub(r'\s+', ' ', str(h).strip().lower())


def parse_bool(val):
    """Convert various boolean representations to True/False."""
    if val is None:
        return False
    s = str(val).strip().lower()
    return s in ('yes', 'y', 'true', '1', 'x', '✓', '✔')


def parse_date(val):
    """Try to parse a date into YYYY-MM-DD format."""
    if val is None or str(val).strip() == '':
        return None

    # Already a datetime object (from openpyxl)
    if isinstance(val, datetime):
        return val.strftime('%Y-%m-%d')

    s = str(val).strip()

    # Common SA date formats
    for fmt in ['%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%Y/%m/%d',
                '%d %b %Y', '%d %B %Y', '%m/%d/%Y']:
        try:
            return datetime.strptime(s, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None  # Could not parse


def parse_grad_year(val):
    """Extract a 4-digit year from various formats."""
    if val is None:
        return None
    s = str(val).strip()
    # Direct 4-digit year
    m = re.search(r'(19|20)\d{2}', s)
    return int(m.group()) if m else None


def clean_phone(val):
    """Clean phone numbers — keep digits, +, spaces."""
    if val is None or str(val).strip() == '':
        return ''
    s = str(val).strip()
    # Remove everything except digits, +, spaces, dashes, parens
    cleaned = re.sub(r'[^\d+\s()\-]', '', s)
    return cleaned.strip()


def clean_email(val):
    """Lowercase and strip email."""
    if val is None or str(val).strip() == '':
        return None
    email = str(val).strip().lower()
    # Basic validation
    if '@' in email and '.' in email.split('@')[-1]:
        return email
    return None


def read_excel(filepath):
    """Read the AlumNet Excel export and return mapped records."""
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        print("ERROR: Empty spreadsheet")
        sys.exit(1)

    # Map headers
    raw_headers = rows[0]
    header_map = {}  # col_index → (table, field)
    unmapped = []

    for i, h in enumerate(raw_headers):
        if h is None:
            continue
        norm = normalize_header(h)
        if norm in COLUMN_MAP:
            header_map[i] = COLUMN_MAP[norm]
        else:
            unmapped.append(str(h))

    if unmapped:
        print(f"\n⚠  Unmapped columns (will be ignored): {', '.join(unmapped)}")

    print(f"\nMapped {len(header_map)} columns from {len(raw_headers)} total headers")

    # Process data rows
    records = []
    for row_num, row in enumerate(rows[1:], start=2):
        profile_data = {
            'country': 'South Africa',  # Default for SACS
            'approved': True,           # Pre-approved since they're existing members
        }
        details_data = {
            'old_boy': True,            # Default assumption
            'comm_pref_email': True,
            'comm_pref_phone': True,
            'comm_pref_sms': True,
            'subscription_tier': 'Standard',
        }
        meta = {'file_number': None, 'row': row_num}

        for col_idx, (table, field) in header_map.items():
            val = row[col_idx] if col_idx < len(row) else None

            if table == 'meta':
                meta[field] = val
                continue

            target = profile_data if table == 'profiles' else details_data

            # Field-specific transformations
            if field == 'email':
                target[field] = clean_email(val)
            elif field == 'grad_year':
                target[field] = parse_grad_year(val)
            elif field == 'date_of_birth':
                target[field] = parse_date(val)
            elif field == 'phone':
                target[field] = clean_phone(val)
            elif field in ('phone_home', 'phone_work', 'phone_fax'):
                target[field] = clean_phone(val)
            elif field in ('old_boy', 'current_parent', 'past_parent',
                           'current_staff', 'past_staff'):
                target[field] = parse_bool(val)
            elif field == 'linkedin_url':
                url = str(val).strip() if val else ''
                if url and not url.startswith('http'):
                    url = f'https://{url}'
                target[field] = url if url else ''
            else:
                target[field] = str(val).strip() if val else ''

        # Build full_name from components
        first = profile_data.get('first_name', '')
        last = profile_data.get('last_name', '')
        known = details_data.get('known_as', '')
        display = known if known else first
        profile_data['full_name'] = f'{display} {last}'.strip()

        # Copy known_as to preferred_name
        if known:
            profile_data['preferred_name'] = known

        records.append({
            'profile': profile_data,
            'details': details_data,
            'meta': meta,
        })

    return records


def validate_records(records):
    """Validate records and separate into importable vs problem rows."""
    valid = []
    problems = []

    seen_emails = set()
    for rec in records:
        issues = []
        email = rec['profile'].get('email')

        # Must have an email to create an auth account
        if not email:
            issues.append('No email address')
        elif email in seen_emails:
            issues.append(f'Duplicate email: {email}')
        else:
            seen_emails.add(email)

        # Must have a name
        if not rec['profile'].get('first_name') and not rec['profile'].get('last_name'):
            issues.append('No name')

        if issues:
            problems.append({**rec, 'issues': issues})
        else:
            valid.append(rec)

    return valid, problems


def generate_report(valid, problems, output_path='migration_report.txt'):
    """Generate a human-readable migration report."""
    lines = [
        '═' * 60,
        '  SACS Alumni Hub — Data Migration Report',
        f'  Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}',
        '═' * 60,
        '',
        f'  Total records read:     {len(valid) + len(problems)}',
        f'  Ready to import:        {len(valid)}',
        f'  Need attention:         {len(problems)}',
        '',
    ]

    # Stats
    with_email = sum(1 for r in valid if r['profile'].get('email'))
    with_phone = sum(1 for r in valid if r['profile'].get('phone'))
    with_grad_year = sum(1 for r in valid if r['profile'].get('grad_year'))
    with_industry = sum(1 for r in valid if r['profile'].get('industry'))
    with_dob = sum(1 for r in valid if r['details'].get('date_of_birth'))

    lines += [
        '── Field Coverage ──────────────────────────────────',
        f'  With email:             {with_email} / {len(valid)}',
        f'  With phone:             {with_phone} / {len(valid)}',
        f'  With grad year:         {with_grad_year} / {len(valid)}',
        f'  With industry:          {with_industry} / {len(valid)}',
        f'  With date of birth:     {with_dob} / {len(valid)}',
        '',
    ]

    # Grad year distribution
    years = {}
    for r in valid:
        y = r['profile'].get('grad_year')
        if y:
            decade = (y // 10) * 10
            years[decade] = years.get(decade, 0) + 1
    if years:
        lines.append('── Graduation Decades ──────────────────────────────')
        for decade in sorted(years):
            lines.append(f'  {decade}s: {years[decade]}')
        lines.append('')

    # Problem rows
    if problems:
        lines.append('── Records Needing Attention ───────────────────────')
        for p in problems[:50]:  # Show first 50
            name = p['profile'].get('full_name', 'Unknown')
            email = p['profile'].get('email', 'no email')
            row = p['meta'].get('row', '?')
            issues = '; '.join(p['issues'])
            lines.append(f'  Row {row}: {name} ({email}) — {issues}')
        if len(problems) > 50:
            lines.append(f'  ... and {len(problems) - 50} more')
        lines.append('')

    lines.append('═' * 60)

    report = '\n'.join(lines)
    with open(output_path, 'w') as f:
        f.write(report)
    print(report)
    return output_path


def do_import(valid, dry_run=True):
    """
    Import validated records into Supabase.

    If dry_run=True (default), just prints what would happen.
    Set dry_run=False to actually create users and insert data.
    """
    if dry_run:
        print(f"\n🔍 DRY RUN — would import {len(valid)} records")
        print("   Set dry_run=False to actually import.\n")

        # Show first 5 records as a preview
        for rec in valid[:5]:
            p = rec['profile']
            d = rec['details']
            print(f"  {p.get('full_name', '?')} | {p.get('email', '?')} "
                  f"| Class of {p.get('grad_year', '?')} "
                  f"| {d.get('title', '')} | OB: {d.get('old_boy', '?')}")
        if len(valid) > 5:
            print(f"  ... and {len(valid) - 5} more")
        return

    # ── Actual import ──
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not url or not key:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
        sys.exit(1)

    sb = create_client(url, key)
    imported = 0
    errors = []

    for i, rec in enumerate(valid):
        email = rec['profile']['email']
        try:
            # 1. Create auth user (they'll get an invite email)
            auth_res = sb.auth.admin.create_user({
                'email': email,
                'email_confirm': True,  # Auto-confirm since they're existing members
                'user_metadata': {
                    'full_name': rec['profile'].get('full_name', ''),
                },
            })
            user_id = auth_res.user.id

            # 2. Update profiles row (trigger handle_new_user creates it)
            #    Small delay to let the trigger fire
            import time
            time.sleep(0.3)

            profile_payload = {k: v for k, v in rec['profile'].items()
                               if v is not None and v != '' and k != 'email'}
            sb.table('profiles').update(profile_payload).eq('id', user_id).execute()

            # 3. Upsert profile_details
            details_payload = {'profile_id': user_id, **rec['details']}
            # Remove empty strings for optional fields
            details_payload = {k: v for k, v in details_payload.items()
                               if v is not None and v != ''}
            sb.table('profile_details').upsert(details_payload).execute()

            imported += 1
            if (i + 1) % 25 == 0:
                print(f"  Imported {i + 1} / {len(valid)} ...")

        except Exception as e:
            errors.append({'email': email, 'error': str(e)})

    print(f"\n✅ Imported {imported} / {len(valid)} records")
    if errors:
        print(f"⚠  {len(errors)} errors:")
        for err in errors[:20]:
            print(f"   {err['email']}: {err['error']}")

    return imported, errors


def generate_mailing_list_csv(records, output_path='mailing_list.csv'):
    """
    Generate a clean CSV of all email addresses for bulk mailing.
    Useful for contact-only records that aren't full portal members.
    """
    emails = set()
    for rec in records:
        email = rec['profile'].get('email')
        if email:
            emails.add(email)

    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['email', 'first_name', 'last_name', 'grad_year'])
        for rec in records:
            email = rec['profile'].get('email')
            if email:
                writer.writerow([
                    email,
                    rec['profile'].get('first_name', ''),
                    rec['profile'].get('last_name', ''),
                    rec['profile'].get('grad_year', ''),
                ])

    print(f"\n📧 Mailing list saved: {output_path} ({len(emails)} unique emails)")
    return output_path


# ─── Main ─────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print("Usage: python3 migrate_alumnet.py <alumnet_export.xlsx> [--import]")
        print("\nDefault: dry-run mode (reads file, validates, generates report)")
        print("Pass --import to actually create users and import data")
        sys.exit(1)

    filepath = sys.argv[1]
    do_live_import = '--import' in sys.argv

    if not os.path.exists(filepath):
        print(f"ERROR: File not found: {filepath}")
        sys.exit(1)

    print(f"Reading {filepath} ...")
    records = read_excel(filepath)
    print(f"Read {len(records)} records")

    valid, problems = validate_records(records)
    report_path = generate_report(valid, problems)
    mailing_path = generate_mailing_list_csv(valid + problems)

    if do_live_import:
        print("\n🚀 LIVE IMPORT MODE")
        confirm = input("Type YES to proceed with import: ")
        if confirm == 'YES':
            do_import(valid, dry_run=False)
        else:
            print("Import cancelled.")
    else:
        do_import(valid, dry_run=True)
        print(f"\n📄 Report saved: {report_path}")
        print("   Review the report, then re-run with --import to import data.")


if __name__ == '__main__':
    main()
