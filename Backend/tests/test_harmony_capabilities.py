from app.harmony import _service_modes, _service_support


def test_requires_same_service_to_support_shape_variables_and_geotiff():
    capabilities = {"services": [
        {"name": "variable-only", "capabilities": {"subsetting": {"variable": True, "shape": False}, "outputFormats": [{"mimeType": "image/tiff"}]}},
        {"name": "shape-only", "capabilities": {"subsetting": {"variable": False, "shape": True}, "outputFormats": [{"mimeType": "image/tiff"}]}},
    ]}
    supported, eligible = _service_support(capabilities)
    assert not supported
    assert eligible == []


def test_accepts_a_single_service_with_required_capabilities():
    capabilities = {"services": [{"name": "asf/nisar-customizer", "capabilities": {
        "subsetting": {"variable": True, "shape": True}, "outputFormats": [{"mimeType": "image/tiff"}]}}]}
    supported, eligible = _service_support(capabilities)
    assert supported
    assert eligible == ["asf/nisar-customizer"]


def test_accepts_reported_bbox_service_for_local_polygon_clipping():
    capabilities = {"services": [{"name": "nasa/harmony-gdal-adapter", "capabilities": {
        "subsetting": {"variable": True, "shape": False, "bbox": True},
        "outputFormats": [{"mimeType": "image/tiff"}],
    }}]}
    supported, eligible = _service_support(capabilities)
    assert supported
    assert eligible == ["nasa/harmony-gdal-adapter"]
    assert _service_modes(capabilities) == {"shape": [], "bbox": ["nasa/harmony-gdal-adapter"]}


def test_does_not_combine_capabilities_from_different_services():
    capabilities = {"services": [
        {"name": "bbox-only", "capabilities": {"subsetting": {"bbox": True, "variable": False}, "outputFormats": [{"mimeType": "image/tiff"}]}},
        {"name": "variable-only", "capabilities": {"subsetting": {"bbox": False, "variable": True}, "outputFormats": [{"mimeType": "image/tiff"}]}},
    ]}
    supported, eligible = _service_support(capabilities)
    assert not supported
    assert eligible == []
