/**
 * RouteMap — displays a ride's GPS route on a Mapbox map.
 * Full-width, half-viewport height hero element. Respects dark mode.
 *
 * Uses onStartShouldSetResponder to prevent the parent ScrollView
 * from intercepting map pan/zoom gestures.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MAPBOX_ACCESS_TOKEN } from '@env';
import { useTheme } from '../contexts/ThemeContext';
import type { FitSample } from '../stores/rideDetailStore';

Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);

interface RouteMapProps {
  samples: FitSample[];
  hasGps: boolean;
  loading?: boolean;
  scrollViewRef?: React.RefObject<any>;
}

const MAP_HEIGHT = Dimensions.get('window').height / 2;

const RouteMap: React.FC<RouteMapProps> = ({ samples, hasGps, loading, scrollViewRef }) => {
  const { theme, isDark } = useTheme();

  const { geoJson, bounds } = useMemo(() => {
    if (!hasGps) return { geoJson: null, bounds: null };

    const coords: [number, number][] = [];
    for (const s of samples) {
      if (s.longitude != null && s.latitude != null) {
        coords.push([s.longitude, s.latitude]);
      }
    }

    if (coords.length < 2) return { geoJson: null, bounds: null };

    const geoJson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
        },
      ],
    };

    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    return {
      geoJson,
      bounds: {
        ne: [maxLng, maxLat] as [number, number],
        sw: [minLng, minLat] as [number, number],
      },
    };
  }, [samples, hasGps]);

  const showRoute = geoJson && bounds;

  const disableParentScroll = () => {
    scrollViewRef?.current?.setNativeProps?.({ scrollEnabled: false });
  };

  const enableParentScroll = () => {
    scrollViewRef?.current?.setNativeProps?.({ scrollEnabled: true });
  };

  return (
    <View
      style={[styles.container, { backgroundColor: isDark ? '#000000' : '#ffffff' }]}
      onTouchStart={disableParentScroll}
      onTouchEnd={enableParentScroll}
      onTouchCancel={enableParentScroll}
    >
      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <Mapbox.MapView
          style={styles.map}
          styleURL={isDark ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
        >
          {showRoute && (
            <>
              <Mapbox.Camera
                bounds={{
                  ne: bounds.ne,
                  sw: bounds.sw,
                  paddingTop: 80,
                  paddingBottom: 40,
                  paddingLeft: 40,
                  paddingRight: 40,
                }}
                animationDuration={0}
              />
              <Mapbox.ShapeSource id="routeSource" shape={geoJson}>
                <Mapbox.LineLayer
                  id="routeLine"
                  style={{
                    lineColor: isDark ? '#ffffff' : theme.colors.primary,
                    lineWidth: 3,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </Mapbox.ShapeSource>
            </>
          )}
        </Mapbox.MapView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: MAP_HEIGHT,
    width: '100%',
  },
  map: {
    flex: 1,
  },
  loadingOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default RouteMap;
