import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { Settings, MapPin, Search, Building2, AlertCircle, CheckCircle2, Link2 } from 'lucide-react';
import { toast } from 'sonner';

type BedType = 'Studio (0bd)' | 'Single (1bd)' | 'Duplex (2bd)' | 'Triplex (3bd)' | 'Fourplex (4bd)' | 'Fiveplex (5bd)';
type BathType = '1BA' | '2BA' | '3BA' | '4BA' | '5BA';

interface UnitMixSelection {
  [key: string]: boolean;
}

export function RentCastComps() {
  const [appsScriptUrl, setAppsScriptUrl] = useState('');
  const [email, setEmail] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [radius, setRadius] = useState('1');
  const [minComps, setMinComps] = useState('10');
  const [maxComps, setMaxComps] = useState('20');
  const [status, setStatus] = useState('Active');
  const [totalSF, setTotalSF] = useState('');
  const [unitMix, setUnitMix] = useState<UnitMixSelection>({});
  const [isUrlConfigured, setIsUrlConfigured] = useState(false);

  const bedTypes: BedType[] = ['Studio (0bd)', 'Single (1bd)', 'Duplex (2bd)', 'Triplex (3bd)', 'Fourplex (4bd)', 'Fiveplex (5bd)'];
  const bathTypes: BathType[] = ['1BA', '2BA', '3BA', '4BA', '5BA'];

  const handleUnitMixToggle = (bed: BedType, bath: BathType) => {
    const key = `${bed}-${bath}`;
    setUnitMix(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const selectedCount = Object.values(unitMix).filter(Boolean).length;

  const handleConfigureUrl = () => {
    if (appsScriptUrl.trim()) {
      setIsUrlConfigured(true);
      toast.success('Model link configured successfully');
    } else {
      toast.error('Please enter a valid model link');
    }
  };

  const handleRunSearch = () => {
    if (!isUrlConfigured) {
      toast.error('Please configure model link first');
      return;
    }
    if (!email || !propertyAddress) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (selectedCount === 0) {
      toast.error('Please select at least one bed/bath combination');
      return;
    }

    // Mock data submission
    const data = {
      email,
      propertyAddress,
      radius,
      minComps,
      maxComps,
      status,
      totalSF,
      unitMix: Object.entries(unitMix)
        .filter(([_, selected]) => selected)
        .map(([key, _]) => key)
    };

    console.log('Submitting to Google Sheets:', data);
    toast.success('Comps search initiated! Data sent to Google Sheets.');
  };

  const handleSave = () => {
    toast.success('Configuration saved');
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-white border-2 border-slate-300 shadow-sm">
      {/* Header */}
      <div className="bg-slate-700 px-8 py-5 border-b-4 border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white border-2 border-slate-300 flex items-center justify-center">
              <Building2 className="w-7 h-7 text-slate-700" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-white font-bold text-xl tracking-tight">RentCast Comps</h1>
              <p className="text-slate-300 text-sm font-medium">Property Comparison Analysis</p>
            </div>
          </div>
          <Badge variant="outline" className="bg-slate-600 text-white border-slate-500 font-semibold px-3 py-1">
            v1.0
          </Badge>
        </div>
      </div>

      <div className="p-8 space-y-8 max-h-[600px] overflow-y-auto bg-slate-50">
        {/* Model Link Configuration */}
        <div className="bg-white border-2 border-slate-300 shadow-sm">
          <div className={`px-6 py-3 border-b-2 ${isUrlConfigured ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link2 className={`w-5 h-5 ${isUrlConfigured ? 'text-emerald-700' : 'text-amber-700'}`} strokeWidth={2.5} />
                <h3 className={`font-bold text-sm uppercase tracking-wide ${isUrlConfigured ? 'text-emerald-900' : 'text-amber-900'}`}>
                  Model Link
                </h3>
              </div>
              {isUrlConfigured ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" strokeWidth={2.5} />
                  <span className="text-xs font-semibold text-emerald-800 uppercase">Connected</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-700" strokeWidth={2.5} />
                  <span className="text-xs font-semibold text-amber-800 uppercase">Not Configured</span>
                </div>
              )}
            </div>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              {isUrlConfigured 
                ? 'Your model link has been successfully configured and verified.' 
                : 'Enter your Google Apps Script model link to enable data submission to your worksheet.'}
            </p>
            <div className="flex gap-3">
              <Input
                type="url"
                placeholder="https://script.google.com/macros/s/..."
                value={appsScriptUrl}
                onChange={(e) => setAppsScriptUrl(e.target.value)}
                disabled={isUrlConfigured}
                className="flex-1 text-sm border-2 border-slate-300 font-mono"
              />
              <Button 
                onClick={() => {
                  if (isUrlConfigured) {
                    setIsUrlConfigured(false);
                    setAppsScriptUrl('');
                    toast.info('Model link cleared');
                  } else {
                    handleConfigureUrl();
                  }
                }}
                variant={isUrlConfigured ? "outline" : "default"}
                size="default"
                className={isUrlConfigured 
                  ? "border-2 border-slate-300 hover:bg-slate-100 font-semibold min-w-[100px]" 
                  : "bg-slate-700 hover:bg-slate-800 font-semibold min-w-[100px]"}
              >
                {isUrlConfigured ? 'Modify' : 'Configure'}
              </Button>
            </div>
          </div>
        </div>

        {/* User Information */}
        <div className="bg-white border-2 border-slate-300 shadow-sm">
          <div className="px-6 py-3 bg-slate-100 border-b-2 border-slate-300">
            <h3 className="font-bold text-sm uppercase tracking-wide text-slate-800">User Information</h3>
          </div>
          <div className="p-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                Email Address <span className="text-red-600">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="your.email@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="text-sm border-2 border-slate-300"
              />
            </div>
          </div>
        </div>

        {/* Property Information */}
        <div className="bg-white border-2 border-slate-300 shadow-sm">
          <div className="px-6 py-3 bg-slate-100 border-b-2 border-slate-300">
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-slate-700" strokeWidth={2.5} />
              <h3 className="font-bold text-sm uppercase tracking-wide text-slate-800">Property Information</h3>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="address" className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                Property Address <span className="text-red-600">*</span>
              </Label>
              <Input
                id="address"
                type="text"
                placeholder="123 Main Street, City, State ZIP"
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
                className="text-sm border-2 border-slate-300"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="totalSF" className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                Total Square Footage <span className="text-slate-500 text-xs font-normal normal-case">(Optional)</span>
              </Label>
              <Input
                id="totalSF"
                type="number"
                placeholder="2,500"
                value={totalSF}
                onChange={(e) => setTotalSF(e.target.value)}
                className="text-sm border-2 border-slate-300 max-w-xs"
              />
            </div>

            {/* Unit Mix Matrix */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  Unit Mix Composition <span className="text-red-600">*</span>
                </Label>
                <Badge variant="secondary" className="bg-slate-700 text-white font-bold px-3 py-1">
                  {selectedCount} Selected
                </Badge>
              </div>
              
              <div className="border-2 border-slate-300 bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b-2 border-slate-300">
                        <th className="text-left text-xs font-bold text-slate-700 uppercase tracking-wide py-3 px-4 border-r-2 border-slate-300">
                          Bedroom Type
                        </th>
                        {bathTypes.map(bath => (
                          <th key={bath} className="text-center text-xs font-bold text-slate-700 uppercase tracking-wide py-3 px-4 border-r-2 border-slate-300 last:border-r-0">
                            {bath}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bedTypes.map((bed, idx) => (
                        <tr key={bed} className={idx !== bedTypes.length - 1 ? 'border-b border-slate-200' : ''}>
                          <td className="text-xs font-semibold text-slate-700 py-4 px-4 border-r-2 border-slate-300 bg-slate-50">
                            {bed}
                          </td>
                          {bathTypes.map((bath, bathIdx) => {
                            const key = `${bed}-${bath}`;
                            return (
                              <td key={bath} className={`text-center py-4 px-4 ${bathIdx !== bathTypes.length - 1 ? 'border-r border-slate-200' : ''}`}>
                                <div className="flex items-center justify-center">
                                  <Checkbox
                                    checked={unitMix[key] || false}
                                    onCheckedChange={() => handleUnitMixToggle(bed, bath)}
                                    className="w-5 h-5 border-2 border-slate-400 data-[state=checked]:bg-slate-700 data-[state=checked]:border-slate-700"
                                  />
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Search Parameters */}
        <div className="bg-white border-2 border-slate-300 shadow-sm">
          <div className="px-6 py-3 bg-slate-100 border-b-2 border-slate-300">
            <div className="flex items-center gap-3">
              <Search className="w-5 h-5 text-slate-700" strokeWidth={2.5} />
              <h3 className="font-bold text-sm uppercase tracking-wide text-slate-800">Search Parameters</h3>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="radius" className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  Radius (Miles) <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="radius"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  className="text-sm border-2 border-slate-300"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="minComps" className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  Minimum Comps <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="minComps"
                  type="number"
                  min="1"
                  value={minComps}
                  onChange={(e) => setMinComps(e.target.value)}
                  className="text-sm border-2 border-slate-300"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxComps" className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  Maximum Comps <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="maxComps"
                  type="number"
                  min="1"
                  value={maxComps}
                  onChange={(e) => setMaxComps(e.target.value)}
                  className="text-sm border-2 border-slate-300"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status" className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                Property Status
              </Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status" className="text-sm border-2 border-slate-300 max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Sold">Sold</SelectItem>
                  <SelectItem value="Off Market">Off Market</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {parseInt(minComps) > parseInt(maxComps) && (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border-2 border-amber-300">
                <AlertCircle className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                <p className="text-sm text-amber-900 font-medium">
                  The minimum comps value must be less than or equal to the maximum comps value.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="px-8 py-5 bg-slate-100 border-t-2 border-slate-300 flex gap-4">
        <Button
          onClick={handleRunSearch}
          className="flex-1 bg-slate-700 hover:bg-slate-800 font-bold text-base h-12 border-2 border-slate-800"
          disabled={parseInt(minComps) > parseInt(maxComps)}
        >
          <Search className="w-5 h-5 mr-2" strokeWidth={2.5} />
          Execute Comps Search
        </Button>
        <Button 
          onClick={handleSave} 
          variant="outline"
          className="border-2 border-slate-300 hover:bg-slate-200 font-bold text-base h-12 min-w-[120px]"
        >
          Save
        </Button>
      </div>
    </div>
  );
}