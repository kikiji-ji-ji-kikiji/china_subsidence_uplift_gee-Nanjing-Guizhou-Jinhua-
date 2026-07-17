// =======================
// 1. LOAD DATASETS
// =======================

// Level 2 (cities)
var china_lvl2 = ee.FeatureCollection("FAO/GAUL/2015/level2");

// Level 1 (provinces)
var china_lvl1 = ee.FeatureCollection("FAO/GAUL/2015/level1");

// Dem
//var dem = ee.Image("USGS/SRTMGL1_003");

// =======================
// 2. DEFINE AOIs
// =======================

// Nanjing (city)
var nanjing = china_lvl2
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .filter(ee.Filter.stringContains('ADM2_NAME', 'Nanjing'));

// Jinhua (city)
var jinhua = china_lvl2
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .filter(ee.Filter.stringContains('ADM2_NAME', 'Jinhua'));

// Guizhou (province-level)
var guizhou = china_lvl1
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .filter(ee.Filter.stringContains('ADM1_NAME', 'Guizhou'));

// Convert to bounding box
var guizhou_bbox = guizhou.geometry().bounds();

// =======================
// 3. SENTINEL-1 FUNCTION
// =======================
function getVelocityProxy(aoi, smooth) {

  var s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
    .filterBounds(aoi)
    .filterDate('2021-01-01', '2024-12-31')
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .select('VV');

  if (smooth) {
    s1 = s1.map(function(img) {
      return img.focal_mean(1)
        .copyProperties(img, ['system:time_start']);
    });
  }

  var withTime = s1.map(function(img) {
    var time = ee.Image.constant(img.date().millis())
      .rename('time')
      .toFloat();
    return img.addBands(time);
  });

  var fit = withTime.select(['time', 'VV'])
                    .reduce(ee.Reducer.linearFit());

  var velocity = fit.select('scale')
    .multiply(1000 * 60 * 60 * 24 * 365)
    .toFloat();

  return velocity.clip(aoi);
}

// =======================
// VISUALIZATION SETTINGS
// =======================
var vis = {
  min: -30,
  max: 30,
  palette: ['FF0000', 'FFFF00', '00FF00', '0000FF']
};

// =======================
// 4. GENERATE MAPS
// =======================
// RAW maps
var nanjing_raw = getVelocityProxy(nanjing, false);
var jinhua_raw  = getVelocityProxy(jinhua, false);
var guizhou_raw = getVelocityProxy(guizhou_bbox, false);

// SMOOTHED maps
var nanjing_smooth = getVelocityProxy(nanjing, true);
var jinhua_smooth  = getVelocityProxy(jinhua, true);
var guizhou_smooth = getVelocityProxy(guizhou_bbox, true);

// =======================
// 5. PANEL VISUALIZATION
// =======================

// Create maps
var map1 = ui.Map();
var map2 = ui.Map();
var map3 = ui.Map();

var linker = ui.Map.Linker([map1, map2, map3]);

// Set basemap
map1.setOptions('SATELLITE');
map2.setOptions('SATELLITE');
map3.setOptions('SATELLITE');

// Add layers

// Nanjing
map1.addLayer(nanjing_raw, vis, 'Raw Velocity');
map1.addLayer(nanjing_smooth, vis, 'Smoothed Velocity');

map1.addLayer(nanjing, {color: 'black'}, 'Boundary');
map1.centerObject(nanjing, 7);

// Jinhua
map2.addLayer(jinhua_raw, vis, 'Raw Velocity');
map2.addLayer(jinhua_smooth, vis, 'Smoothed Velocity');

map2.addLayer(jinhua, {color: 'green'}, 'Boundary');
map2.centerObject(jinhua, 7);

// Guizhou
map3.addLayer(guizhou_raw, vis, 'Raw Velocity');
map3.addLayer(guizhou_smooth, vis, 'Smoothed Velocity');

map3.addLayer(guizhou, {color: 'yellow'}, 'Boundary');
map3.centerObject(guizhou, 6);

var title1 = ui.Label('(A) Nanjing', {fontWeight: 'bold'});
var title2 = ui.Label('(B) Jinhua', {fontWeight: 'bold'});
var title3 = ui.Label('(C) Guizhou', {fontWeight: 'bold'});

var panel1 = ui.Panel([title1, map1]);
var panel2 = ui.Panel([title2, map2]);
var panel3 = ui.Panel([title3, map3]);


// =======================
// PANEL LAYOUT (MISSING)
// =======================

// Top row
var topRow = ui.Panel({
  widgets: [panel1, panel2],
  layout: ui.Panel.Layout.Flow('horizontal')
});

// Bottom row
var bottomRow = ui.Panel({
  widgets: [panel3],
  layout: ui.Panel.Layout.Flow('horizontal')
});

// Main panel
var mainPanel = ui.Panel({
  widgets: [topRow, bottomRow],
  layout: ui.Panel.Layout.Flow('vertical')
});

// Display UI
ui.root.clear();
ui.root.add(mainPanel);

// =======================
// 6. LEGEND
// =======================

var legend = ui.Panel({style: {position: 'bottom-center'}});

var title = ui.Label('LOS Velocity (mm/year)');
legend.add(title);

var makeRow = function(color, name) {
  var colorBox = ui.Label({
    style: {
      backgroundColor: color,
      padding: '8px',
      margin: '0 0 4px 0'
    }
  });

  var description = ui.Label(name);
  return ui.Panel([colorBox, description], ui.Panel.Layout.Flow('horizontal'));
};

legend.add(makeRow('red', 'High Subsidence (-)'));
legend.add(makeRow('yellow', 'Moderate Subsidence'));
legend.add(makeRow('green', 'Stable'));
legend.add(makeRow('blue', 'Uplift (+)'));

mainPanel.add(legend);

// =======================
// 7. HOTSPOT POINTS
// =======================

// Representative points
var pt_nanjing = nanjing.geometry().centroid();
var pt_jinhua = jinhua.geometry().centroid();
var pt_guizhou = guizhou_bbox.centroid(ee.ErrorMargin(100));

// Add red dots on map
map1.addLayer(pt_nanjing, {color: 'red'}, 'Hotspot');
map2.addLayer(pt_jinhua, {color: 'red'}, 'Hotspot');
map3.addLayer(pt_guizhou, {color: 'red'}, 'Hotspot');

// =======================
// 7.1 TIME-SERIES (1 POINT PER CITY)
// =======================
// Function to create time series chart
function createTimeSeries(point, name) {

  var s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
    .filterBounds(point)
    .filterDate('2021-01-01', '2024-12-31')
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .select('VV');

  // RAW
  var rawChart = ui.Chart.image.series({
    imageCollection: s1,
    region: point,
    reducer: ee.Reducer.mean(),
    scale: 30
  }).setOptions({
    title: name + ' RAW Backscatter',
    lineWidth: 1,
    pointSize: 2
  });

  // SMOOTHED
  var smoothed = s1.map(function(img) {
    return img.focal_mean(1)
      .copyProperties(img, ['system:time_start']);
  });

  var smoothChart = ui.Chart.image.series({
    imageCollection: smoothed,
    region: point,
    reducer: ee.Reducer.mean(),
    scale: 30
  }).setOptions({
    title: name + ' SMOOTHED Trend',
    lineWidth: 2,
    pointSize: 0
  });

  print(rawChart);
  print(smoothChart);
}



// Generate charts
createTimeSeries(pt_nanjing, 'Nanjing');
createTimeSeries(pt_jinhua, 'Jinhua');
createTimeSeries(pt_guizhou, 'Guizhou');

//
function summarizeRegion(aoi, name) {
  var s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
    .filterBounds(aoi)
    .filterDate('2021-01-01', '2024-12-31')
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .select('VV');

  var count = s1.size();

  var stats = getVelocityProxy(aoi).reduceRegion({
    reducer: ee.Reducer.mean()
      .combine(ee.Reducer.minMax(), '', true),
    geometry: aoi,
    scale: 1000,
    maxPixels: 1e13
  });

print(name + ' Summary', {
  City: name,
  TimeSpan: '2021–2024',
  Scenes: count,
  MeanVelocity: stats.get('scale_mean'),
  MinVelocity: stats.get('scale_min'),
  MaxVelocity: stats.get('scale_max'),
  Observation: 'Spatially heterogeneous deformation with localized subsidence hotspots'
});
}

// =======================
// 8. EXPORT FINAL 
// =======================

// Clip DEM
//var dem_nanjing = dem.clip(nanjing);
//var dem_jinhua  = dem.clip(jinhua);
//var dem_guizhou = dem.clip(guizhou_bbox);


// -------- NANJING --------
Export.image.toDrive({
  image: nanjing_raw,
  description: 'Nanjing_RAW_velocity',
  scale: 500,
  region: nanjing.geometry(),
  maxPixels: 1e13
});

Export.image.toDrive({
  image: nanjing_smooth,
  description: 'Nanjing_SMOOTH_velocity',
  scale: 500,
  region: nanjing.geometry(),
  maxPixels: 1e13
});

// -------- JINHUA --------
Export.image.toDrive({
  image: jinhua_raw,
  description: 'Jinhua_RAW_velocity',
  scale: 500,
  region: jinhua.geometry(),
  maxPixels: 1e13
});

Export.image.toDrive({
  image: jinhua_smooth,
  description: 'Jinhua_SMOOTH_velocity',
  scale: 500,
  region: jinhua.geometry(),
  maxPixels: 1e13
});

// -------- GUIZHOU --------
Export.image.toDrive({
  image: guizhou_raw,
  description: 'Guizhou_RAW_velocity',
  scale: 500,
  region: guizhou_bbox,
  maxPixels: 1e13
});

Export.image.toDrive({
  image: guizhou_smooth,
  description: 'Guizhou_SMOOTH_velocity',
  scale: 500,
  region: guizhou_bbox,
  maxPixels: 1e13
});


// =======================
// 9. SUMMARY STATISTICS
// =======================
summarizeRegion(nanjing, 'Nanjing');
summarizeRegion(jinhua, 'Jinhua');
summarizeRegion(guizhou_bbox, 'Guizhou');

// =======================
// 10. BUILD SUMMARY TABLE
// =======================
function getRow(aoi, name) {
  // Scene count
  var s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
    .filterBounds(aoi)
    .filterDate('2021-01-01', '2024-12-31')
    .filter(ee.Filter.eq('instrumentMode', 'IW'));

  var count = s1.size();

  // RAW stats
  var rawStats = getVelocityProxy(aoi, false).reduceRegion({
    reducer: ee.Reducer.mean().combine(ee.Reducer.minMax(), '', true),
    geometry: aoi,
    scale: 1000,
    maxPixels: 1e13
  });

  // SMOOTH stats
  var smoothStats = getVelocityProxy(aoi, true).reduceRegion({
    reducer: ee.Reducer.mean().combine(ee.Reducer.minMax(), '', true),
    geometry: aoi,
    scale: 1000,
    maxPixels: 1e13
  });

  return ee.Feature(null, {

    City: name,

    // RAW
    RAW_MaxSubsidence: rawStats.get('scale_min'),
    RAW_MaxUplift: rawStats.get('scale_max'),
    RAW_MeanVelocity: rawStats.get('scale_mean'),

    // SMOOTHED
    SMOOTH_MaxSubsidence: smoothStats.get('scale_min'),
    SMOOTH_MaxUplift: smoothStats.get('scale_max'),
    SMOOTH_MeanVelocity: smoothStats.get('scale_mean'),

    // Extra info
    Method: 'SAR Backscatter Trend',
    Observation: 'Spatially heterogeneous deformation with hotspots',
    Scenes: count,
    TimeSpan: '2021–2024'
  });
}

// Create table
var table = ee.FeatureCollection([
  getRow(nanjing, 'Nanjing'),
  getRow(jinhua, 'Jinhua'),
  getRow(guizhou_bbox, 'Guizhou')
]);

// Print table
print('Final Summary Table', table);

Export.table.toDrive({
  collection: table,
  description: 'InSAR_summary_table',
  fileFormat: 'CSV'
});
