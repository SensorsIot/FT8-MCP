#!/usr/bin/env python3
"""
Test QSO execution via MCP web API
Completely independent from the MCP server - uses HTTP API only
"""

import requests
import json
import time
import sys

MCP_API_URL = "http://localhost:3001/api"

def get_slices():
    """Get current slice states with decoded stations"""
    response = requests.get(f"{MCP_API_URL}/slices")
    response.raise_for_status()
    return response.json()

def find_cq_stations(slices, channel='C', min_snr=-20, max_snr=-10):
    """Find stations calling CQ on specified channel within SNR range"""
    cq_stations = []

    for slice_data in slices:
        # API uses 'id' not 'channel'
        if slice_data.get('id') == channel or slice_data.get('name') == channel:
            stations = slice_data.get('stations', [])
            for station in stations:
                message = station.get('message', '')
                snr = station.get('snr', 0)
                callsign = station.get('callsign', '')
                grid = station.get('grid', '')

                # Look for CQ messages in SNR range
                if 'CQ' in message and min_snr <= snr <= max_snr and callsign:
                    cq_stations.append({
                        'callsign': callsign,
                        'grid': grid,
                        'snr': snr,
                        'message': message,
                        'time': station.get('lastSeen', '')
                    })

    return cq_stations

def execute_qso(instance_id, target_callsign, my_callsign, my_grid):
    """Execute QSO via web API"""
    payload = {
        'instanceId': instance_id,
        'targetCallsign': target_callsign,
        'myCallsign': my_callsign,
        'myGrid': my_grid
    }

    response = requests.post(f"{MCP_API_URL}/qso/execute", json=payload)
    response.raise_for_status()
    return response.json()

def main():
    print("\n=== MCP QSO Test (via Web API) ===\n")

    # Check for manual callsign specification
    if len(sys.argv) >= 3:
        target_call = sys.argv[1]
        target_grid = sys.argv[2]
        channel = sys.argv[3] if len(sys.argv) > 3 else 'C'
        instance_id = f'Slice-{channel}'

        print(f"Manual mode: Testing QSO with {target_call}")
        print(f"Target: {target_call}")
        print(f"Grid: {target_grid}")
        print(f"Channel: {channel} (20m if C)")
        print(f"Instance: {instance_id}")

        result = execute_qso(
            instance_id=instance_id,
            target_callsign=target_call,
            my_callsign='HB9BLA',
            my_grid='JN37VL'
        )

        print("\n=== QSO Started ===")
        print(json.dumps(result, indent=2))
        print("\nQSO is now running autonomously. Monitor WSJT-X window for progress.")
        return

    # Get current slice states
    print("Fetching current slice states...")
    slices = get_slices()

    # Show all channels
    print("\n=== Current Activity ===")
    for slice_data in slices:
        channel = slice_data.get('id', slice_data.get('name', '?'))
        band = slice_data.get('band', '?')
        freq = slice_data.get('dialFrequency', 0)
        stations = slice_data.get('stations', [])
        cq_count = sum(1 for s in stations if 'CQ' in s.get('message', ''))
        print(f"Channel {channel} ({band}, {freq/1e6:.3f} MHz): {len(stations)} stations, {cq_count} calling CQ")

    # Find weak CQ stations on 20m (Channel C)
    print("\nSearching for weak CQ stations on 20m (Channel C)...")
    cq_stations = find_cq_stations(slices, channel='C', min_snr=-20, max_snr=-10)

    if not cq_stations:
        print("No weak CQ stations found on 20m")
        print("\nSearching for any CQ stations on 20m...")
        cq_stations = find_cq_stations(slices, channel='C', min_snr=-30, max_snr=0)

    if not cq_stations:
        print("No CQ stations found on 20m")
        print("\nUsage: python test-qso.py <callsign> <grid> [channel]")
        print("Example: python test-qso.py PD1HPB JO22 C")
        sys.exit(1)

    # Sort by SNR (weakest first)
    cq_stations.sort(key=lambda x: x['snr'])

    print(f"\nFound {len(cq_stations)} CQ stations on 20m:")
    for i, station in enumerate(cq_stations[:5], 1):
        print(f"  {i}. {station['callsign']:10s} {station['grid']:6s} {station['snr']:+3d} dB - {station['message']}")

    # Select the weakest station
    target = cq_stations[0]

    print(f"\n=== Starting QSO with {target['callsign']} ===")
    print(f"Target: {target['callsign']}")
    print(f"Grid: {target['grid']}")
    print(f"SNR: {target['snr']:+d} dB")
    print(f"Channel: C (20m, 14.074 MHz)")
    print(f"Instance: Slice-C")

    # Execute QSO
    result = execute_qso(
        instance_id='Slice-C',
        target_callsign=target['callsign'],
        my_callsign='HB9BLA',
        my_grid='JN37VL'
    )

    print("\n=== QSO Started ===")
    print(json.dumps(result, indent=2))
    print("\nQSO is now running autonomously. Monitor WSJT-X Slice-C window for progress.")
    print("The QSO state machine will handle the complete exchange automatically.")

if __name__ == '__main__':
    try:
        main()
    except requests.exceptions.ConnectionError:
        print("Error: Cannot connect to MCP server at http://localhost:3001")
        print("Make sure the MCP server is running.")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
